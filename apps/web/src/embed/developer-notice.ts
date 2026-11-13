/**
 * 嵌入组件给合作网站开发者的提示（M9E-03，ADR 0090 第四节）：放组件的人只能从浏览器控制台知道「容器找不到」「网站没在白名单」。
 * 组件代码里的控制台输出只在这里：一句固定的前缀 + 调用方给的固定说明，不输出任何用户数据。`styles.edge.test.ts` 只放行这一行。
 */
export function tellDeveloper(message: string): void {
  console.error(`NozomiBooking：${message}`);
}
