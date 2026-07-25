import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(
  new URL("../now/dashboard.js", import.meta.url),
  "utf8"
);
const baseData = JSON.parse(
  await readFile(new URL("../now/data.json", import.meta.url), "utf8")
);

function todayKey() {
  const today = new Date();
  return [
    today.getFullYear(),
    String(today.getMonth() + 1).padStart(2, "0"),
    String(today.getDate()).padStart(2, "0")
  ].join("-");
}

async function render(data) {
  const root = { innerHTML: "" };
  const sandbox = {
    window: {},
    document: {
      readyState: "complete",
      getElementById: (id) => (id === "now-dashboard-root" ? root : null)
    },
    fetch: async () => ({
      ok: true,
      json: async () => data
    }),
    console,
    Date,
    Intl,
    Map,
    Object,
    String,
    Number,
    Math,
    Array,
    Boolean,
    setTimeout,
    clearTimeout
  };

  vm.runInNewContext(source, sandbox);
  await new Promise((resolve) => setTimeout(resolve, 20));
  return root.innerHTML;
}

const emptyHtml = await render(baseData);
assert.match(emptyHtml, /等待今晚复盘/);
assert.match(emptyHtml, /习惯热力图/);

const completedHtml = await render({
  ...baseData,
  records: [
    {
      date: todayKey(),
      screenTimeMinutes: 95,
      habits: {
        sleepEarly: true,
        noPhoneBeforeBed: true,
        screenTimeControlled: true,
        reading: true,
        exercise: null,
        deepWork: true,
        topOne: true,
        review: true
      }
    }
  ]
});

assert.match(completedHtml, /100%/);
assert.match(completedHtml, /1 小时 35 分/);
assert.match(completedHtml, /完成 7\/7 项/);

console.log("now dashboard tests passed");
