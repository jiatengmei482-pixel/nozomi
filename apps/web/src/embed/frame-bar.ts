/**
 * 嵌入预订页手机底部按钮条的摆放（M9E-32，ADR 0100 第三节）：纯计算，不碰 DOM，单元测试直接测。
 *
 * iframe 被宿主撑到内容全高（resize 消息），iframe 里的 position: fixed / sticky 只会贴在 iframe 的底边（= 内容最末尾），
 * 客人在宿主页上滚动时看不到。所以宿主在 scroll、resize 时发 `viewport{ height, top }`（iframe 上沿相对宿主可视区的位置），
 * iframe 里据此算出自己露在宿主屏幕上的那一截的底边，把按钮条往上挪到那里。
 *
 * 坐标一律是 iframe 自己视口里的 px（getBoundingClientRect 的坐标）：iframe 内部滚动（3D 验证时 iframe 被设成可视高度）也照样对。
 */

/** 宿主可视区：高度，和 iframe 上沿的位置（旧版组件脚本不发 top，为 null） */
export interface HostViewport {
  height: number;
  top: number | null;
}

/** 宿主可视区的最新值和订阅（EmbedFrame 收到 viewport 时更新；按钮条订阅后直接改自己的位置，不让整页重新渲染） */
export interface HostViewportSource {
  current(): HostViewport | null;
  subscribe(listener: () => void): () => void;
}

export interface HostViewportStore extends HostViewportSource {
  set(value: HostViewport): void;
}

export function createHostViewportStore(): HostViewportStore {
  let value: HostViewport | null = null;
  const listeners = new Set<() => void>();
  return {
    current: () => value,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    set(next) {
      if (value !== null && value.height === next.height && value.top === next.top) return;
      value = next;
      for (const listener of [...listeners]) listener();
    },
  };
}

export interface FrameBarInput {
  /** iframe 上沿相对宿主可视区上沿（可为负数：iframe 上半截已经滚出屏幕） */
  frameTop: number;
  /** 宿主可视区的高度 */
  hostHeight: number;
  /** iframe 自己视口的高度（= 内容全高） */
  frameHeight: number;
  /** 按钮条在文档流中的原位置的上沿（iframe 视口坐标，不含挪动） */
  slotTop: number;
  /** 按钮条的高度 */
  barHeight: number;
}

/** iframe 露在宿主屏幕上的那一截的底边（iframe 视口坐标）：min(内容高度, 宿主可视高度 − iframe 上沿) */
export function visibleBottom({ frameTop, hostHeight, frameHeight }: Pick<FrameBarInput, "frameTop" | "hostHeight" | "frameHeight">): number {
  return Math.min(frameHeight, hostHeight - frameTop);
}

/**
 * 按钮条要往上挪多少 px（≤ 0，用作 translateY）：条的下沿对齐露出来那一截的底边；
 * - 不低于原位置（返回值不大于 0）：滚到最底下时条回到文档流里自己的位置，不越过后面的内容；
 * - 不高过 iframe 的上沿（条的上沿 ≥ 0）：iframe 只露出一点点或整个在屏幕下方时，条停在 iframe 顶部，不跑到 iframe 外面。
 */
export function frameBarShift(input: FrameBarInput): number {
  const target = Math.max(0, visibleBottom(input) - input.barHeight);
  const shift = Math.min(0, Math.round(target - input.slotTop));
  // -0 写进样式是 "-0px"，统一成 0
  return shift === 0 ? 0 : shift;
}
