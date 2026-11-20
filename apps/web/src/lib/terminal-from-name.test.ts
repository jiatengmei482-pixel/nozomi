/** 从地点名称认航站楼（包车机场快捷入口预填「航站楼（选填）」）的单元测试 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { registeredTerminalNumber, replaceTerminalInName, terminalFromName } from "./terminal-from-name.ts";

test("认出各种语言、写法的航站楼，交出名称里的原文和编号", () => {
  const cases: [string, string, number][] = [
    ["羽田空港第3ターミナル", "第3ターミナル", 3],
    ["羽田空港 第 2 旅客ターミナル", "第 2 旅客ターミナル", 2],
    ["成田国際空港 第１ターミナル", "第１ターミナル", 1],
    ["成田空港第二ターミナル", "第二ターミナル", 2],
    ["ターミナル2 出発ロビー", "ターミナル2", 2],
    ["上海浦东国际机场第1航站楼", "第1航站楼", 1],
    ["首都机场 3号航站楼", "3号航站楼", 3],
    ["桃園機場第二航廈", "第二航廈", 2],
    ["인천국제공항 제2여객터미널", "제2여객터미널", 2],
    ["Narita International Airport Terminal 1", "Terminal 1", 1],
    ["Haneda Airport terminal 3", "terminal 3", 3],
    ["Incheon Airport T2", "T2", 2],
    ["关西机场T1", "T1", 1],
  ];
  for (const [name, text, number] of cases) assert.deepEqual(terminalFromName(name), { text, number }, name);
});

test("不带编号、或只是像的不认", () => {
  for (const name of ["成田国際空港", "Narita International Airport", "羽田空港 国際線ターミナル", "Bus Terminal", "T-Site 代官山", "ST2 Building", "新宿駅西口", "Terminal 0"]) {
    assert.equal(terminalFromName(name), null, name);
  }
});

test("登记的航站楼按编码或名称取编号", () => {
  assert.equal(registeredTerminalNumber({ code: "NRT-T1", name: { zh: "第 1 航站楼" } }), 1);
  assert.equal(registeredTerminalNumber({ code: "HND-X", name: { ja: "第3ターミナル" } }), 3);
  assert.equal(registeredTerminalNumber({ code: "HND-INTL", name: { zh: "国际线航站楼" } }), null);
  assert.equal(registeredTerminalNumber({ code: "X", name: null }), null);
});

test("客人改预填的航站楼：名称里那段换掉；清空就去掉；不剩东西时保留原名", () => {
  const found = { text: "第3ターミナル", number: 3 };
  assert.equal(replaceTerminalInName("羽田空港第3ターミナル", found, "第3ターミナル"), "羽田空港第3ターミナル");
  assert.equal(replaceTerminalInName("羽田空港第3ターミナル", found, "第 2 航站楼"), "羽田空港第 2 航站楼");
  assert.equal(replaceTerminalInName("羽田空港 第3ターミナル 出発", found, ""), "羽田空港 出発");
  assert.equal(replaceTerminalInName("第3ターミナル", found, ""), "第3ターミナル");
  assert.equal(replaceTerminalInName("Haneda", found, "T2"), "Haneda T2");
});
