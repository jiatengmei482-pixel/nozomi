/**
 * 允许从本站链出去的站外地址，只有这里登记的这几个（数据来源的署名要求「链过去」）。
 * 别处的代码不能写站外网址；要新增外链，先在这里登记，测试会核对这份清单。
 */
export const EXTERNAL_LINKS = {
  geonames: "https://www.geonames.org/",
  ccBy4: "https://creativecommons.org/licenses/by/4.0/",
  ourairports: "https://ourairports.com/data/",
} as const;

export type ExternalLinkKey = keyof typeof EXTERNAL_LINKS;
