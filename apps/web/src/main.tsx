import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import { App } from "./App.tsx";
import { ErrorBoundary } from "./components/ErrorBoundary.tsx";
import { EmbedApp, isEmbedBookDocument } from "./pages/embed/EmbedApp.tsx";
import "./styles/index.css";

const container = document.getElementById("root");
if (!container) throw new Error("index.html 里缺少 #root");

// 嵌入预订页（M9E-16，ADR 0095 第四节第 2 小节）：这个文档允许被合作网站嵌入，所以按加载时的路径只挂 /embed/book* 那一棵路由树，
// 登录、两个后台、主站页面一概不挂（前端换路由时浏览器不再检查 CSP）
const embedded = isEmbedBookDocument(window.location.pathname);
// 嵌入页的外观以组件的 --nzb-* 为准、只有亮色（M9E-17，Q15；embed.css）
if (embedded) {
  document.documentElement.dataset["embedBook"] = "";
  document.documentElement.dataset["theme"] = "light";
}

createRoot(container).render(
  <StrictMode>
    <ErrorBoundary>
      <BrowserRouter>
        {embedded ? <EmbedApp /> : <App />}
      </BrowserRouter>
    </ErrorBoundary>
  </StrictMode>,
);
