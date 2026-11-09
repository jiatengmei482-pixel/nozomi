# M7-05 测试环境车型组的代表车型（2026-11-09）

数据来源：业主从 2.0 后台 settings/vehicle-types 只读抄录的 57 个车型（不进仓库）。按 ADR 0068 第 5 节：按名称对应，日本 / 通用（抄录第 1 页）优先；只填空着的代表车型；组合（选车依据）一律不改；日本实际不在跑的车型不写进去（按「日本当地实际车型」的要求）。写入走平台接口（QA 平台账号），每条都有审计记录。

## 已填（9 个）

| 车型组 | 对应的抄录车型 | 填入的代表车型 → 同级说明 | 最多乘客 / 行李（组合未改） | 调整 |
| --- | --- | --- | --- | --- |
| VG-ECO-4 经济4座 | Economy 4 Seater（通用）| Toyota Corolla, Honda Civic or similar | 3 人 2 件 | 去掉「(Altis)」：Corolla Altis 是东南亚的叫法 |
| VG-ECO-5 经济5座 | Economy 5 Seater（通用）| Toyota Prius, Toyota Corolla or similar | 4 人 2 件 | 原样 |
| VG-CMF-5 舒适5座 | Comfort 5 seater-jp（日本专用）| Toyota Camry or similar | 4 人 2 件 | 用日本专用那条（通用那条另有 Honda Accord）。注：Camry 2023 年底起日本新车停售，但存量车仍大量在跑，按业主 2.0 的日本数据保留 |
| VG-CMF-7 舒适7座 | Comfort 7 Seater（通用）| Honda Odyssey or similar | 6 人 4 件 | 去掉 Kia Carnival：日本没有在售 |
| VG-ECO-9 经济9座 | Economy 9 Seater（通用）| Toyota Hiace or similar | 8 人 6 件 | 去掉 Hyundai Staria：日本没有在售 |
| VG-ECO-10 经济10座 | Economy 10 Seater（通用）| Toyota Hiace or similar | 9 人 9 件 | 去掉 Hyundai Staria：日本没有在售 |
| VG-LUX-5 豪华5座 | Premium 5 Seater（通用）| Mercedes-Benz E-Class, BMW 5 Series or similar | 4 人 2 件 | 业主 2026-11-09 确定豪华 5 座 = Premium 5 Seater |
| VG-LUX-7 豪华7座 | Premium 7 Seater（通用）| Toyota Alphard, Toyota Vellfire or similar | 6 人 4 件 | 业主 2026-11-09 确定豪华 7 座 = Premium 7 Seater，组合不动 |
| VG-ECO-7 经济7座 | 业主设计稿（2026-11-09）| Toyota Noah / Voxy, Kia Carnival or similar | 4 人 3 件、4 人 4 件、5 人 4 件、6 人 4 件 | 业主指示按设计稿覆盖原值「丰田阿尔法2代」；Kia Carnival 按业主设计稿保留。组合是业主本人 2026-11-09 在后台加的，最多 6 人 4 件和设计稿一致，没改 |

这 9 个车型的最多乘客 / 行李和现有组合一致，所以选车结果不变。

## 抄录里有、NOZOMI 没有对应车型组的

People carrier van、Standard TAXI、EV Car、Economy 7/13 Seater 以外的面包车、Bus 系列、共享专车、专线，以及中国、东南亚、越南的车型：NOZOMI 现在只有上面 9 个车型组，没有对应的就不建（建车型组是平台主数据的决定；Bus 类按 ADR 0063 第 7 项的改进方案）。

## 验收时发现的后续变化（2026-11-09）

- 业主本人 02:50 在后台给 ECO-5、ECO-10、CMF-5、CMF-7、LUX-5、LUX-7（以及 ECO-7）加了更小的人数 / 行李组合；最多值没有变，所以 4 项标识不受影响。上表「最多乘客 / 行李」写的是最大值。
- 业主同时新建了 24 个车型组（现在共 33 个），代表车型用中文写（例如「江铃全顺」），不在这次 M7-05 的填写范围内；页面显示为「江铃全顺 or similar」（中英混排）。是否改成英文车型名由业主决定；页面给代表车型标的语言属性目前固定为英文，改为按内容判断登记为后续改进。
