/**
 * 报价用的「商品目录」缓存（ADR 0020；需求文档：价格规则和区域多边形要缓存，租户改规则后 1 分钟内生效）。
 *
 * 缓存的是一组候选商品连同它们的区域图形、价格规则、调价规则、服务规则（`loadQuoteCandidates` 的结果），按「城市 + 品类 + 接送点」分开存，
 * 放在进程内存里，不引入外部缓存组件。
 * - 有效期 30 秒：供应商改了规则，最迟 30 秒后新的询价就按新规则算（多个实例各有各的缓存，所以留出一倍的余量，仍在 1 分钟以内）。
 *   不做主动失效——那需要跨实例通知，有效期本身已经满足「1 分钟内生效」。
 * - 库存、节假日、供应商的评分不在缓存里：每次询价现查（库存差一单就是超卖）。
 * - 同一个键同时来几个请求只取一次数。条目数有上限，超了先丢最久没用的。
 * - 试算接口不用缓存里的旧数据（`fresh`）：运营排查、供应商试算要看的是现在的规则；它们取到的新数据会顺手更新缓存。
 */
export const QUOTE_CATALOG_TTL_MS = 30_000;
export const QUOTE_CATALOG_MAX_ENTRIES = 500;

interface Entry<T> {
  loadedAt: number;
  value: Promise<T>;
}

export class QuoteCatalogCache<T> {
  private readonly entries = new Map<string, Entry<T>>();
  private readonly ttlMs: number;
  private readonly maxEntries: number;
  private readonly now: () => number;

  constructor(options: { now: () => number; ttlMs?: number; maxEntries?: number }) {
    this.now = options.now;
    this.ttlMs = options.ttlMs ?? QUOTE_CATALOG_TTL_MS;
    this.maxEntries = options.maxEntries ?? QUOTE_CATALOG_MAX_ENTRIES;
  }

  get size(): number {
    return this.entries.size;
  }

  /** 取这个键的数据：没过期就用缓存里的；过期了、没有、或要求 `fresh` 就调 `load` 取新的。取数失败不留在缓存里。 */
  async get(key: string, load: () => Promise<T>, options: { fresh?: boolean } = {}): Promise<T> {
    const now = this.now();
    const cached = this.entries.get(key);
    if (cached !== undefined && options.fresh !== true && now - cached.loadedAt < this.ttlMs) {
      // 挪到最后：最近用过
      this.entries.delete(key);
      this.entries.set(key, cached);
      return cached.value;
    }
    const entry: Entry<T> = { loadedAt: now, value: load() };
    this.entries.delete(key);
    this.entries.set(key, entry);
    while (this.entries.size > this.maxEntries) this.entries.delete(this.entries.keys().next().value as string);
    try {
      return await entry.value;
    } catch (err) {
      if (this.entries.get(key) === entry) this.entries.delete(key);
      throw err;
    }
  }

  clear(): void {
    this.entries.clear();
  }
}
