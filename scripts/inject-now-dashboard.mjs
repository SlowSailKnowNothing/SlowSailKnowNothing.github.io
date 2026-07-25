import { readFile, writeFile } from "node:fs/promises";

const htmlPath = new URL("../now/index.html", import.meta.url);
const rscPath = new URL("../now/index.txt", import.meta.url);
const layoutChunkPath = new URL(
  "../_next/static/chunks/app/layout-26e7eec3d6181f6d.js",
  import.meta.url
);

const dashboardHead = [
  '<link rel="stylesheet" href="/now/dashboard.css" data-now-dashboard="true"/>',
  '<script src="/now/dashboard.js" data-now-dashboard="true" defer></script>'
].join("");

const dashboardRoot =
  '<main id="now-dashboard-root"><noscript>请启用 JavaScript 查看此刻页面。</noscript></main>';

function replacePageElement(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return Object.values(value).some((child) => replacePageElement(child));
  }

  if (!Array.isArray(value)) return false;

  if (
    value[0] === "$" &&
    value[1] === "section" &&
    value[3] &&
    typeof value[3].className === "string" &&
    value[3].className.includes("site-container pb-24 pt-32")
  ) {
    value.splice(
      0,
      value.length,
      "$",
      "main",
      null,
      {
        id: "now-dashboard-root",
        children: [
          [
            "$",
            "noscript",
            null,
            { children: "请启用 JavaScript 查看此刻页面。" }
          ]
        ]
      }
    );
    return true;
  }

  if (
    value[0] === "$" &&
    value[1] === "main" &&
    value[3] &&
    value[3].id === "now-dashboard-root"
  ) {
    return true;
  }

  return value.some((child) => replacePageElement(child));
}

async function updateHtml() {
  let html = await readFile(htmlPath, "utf8");

  if (!html.includes('data-now-dashboard="true"')) {
    html = html.replace("</head>", `${dashboardHead}</head>`);
  }

  html = html
    .replace(/<main>[\s\S]*?<\/main>/, dashboardRoot)
    .replace(
      '<meta name="description" content="xiaohei 经确认并适合公开的核心上下文。"/>',
      '<meta name="description" content="xiaohei 的当前关注、习惯热力图与个人运行状态。"/>'
    );

  await writeFile(htmlPath, html);
}

async function updateRsc() {
  const source = await readFile(rscPath, "utf8");
  const lines = source.split("\n");
  const payloadIndex = lines.findIndex((line) => line.startsWith("0:"));

  if (payloadIndex === -1) {
    throw new Error("Unable to locate RSC payload");
  }

  const payload = JSON.parse(lines[payloadIndex].slice(2));
  if (!replacePageElement(payload)) {
    throw new Error("Unable to locate the current /now page element");
  }

  lines[payloadIndex] = `0:${JSON.stringify(payload)}`;
  await writeFile(rscPath, lines.join("\n"));
}

async function updateLayoutLoader() {
  let source = await readFile(layoutChunkPath, "utf8");
  const marker = "/* now-dashboard-loader */";

  if (source.includes(marker)) return;

  source += `
${marker}
(()=>{const isNow=()=>/^\\/now\\/?$/.test(location.pathname);const load=()=>{if(!isNow())return;if(window.__nowDashboardReady){window.renderNowDashboard?.();return}if(!document.querySelector('link[data-now-dashboard]')){const l=document.createElement("link");l.rel="stylesheet";l.href="/now/dashboard.css";l.dataset.nowDashboard="true";document.head.appendChild(l)}if(!document.querySelector('script[data-now-dashboard]')){const s=document.createElement("script");s.src="/now/dashboard.js";s.dataset.nowDashboard="true";s.defer=true;document.head.appendChild(s)}};new MutationObserver(load).observe(document.documentElement,{childList:true,subtree:true});addEventListener("popstate",()=>setTimeout(load,0));document.addEventListener("click",()=>setTimeout(load,0),true);load()})();
`;

  await writeFile(layoutChunkPath, source);
}

await updateHtml();
await updateRsc();
await updateLayoutLoader();
