/** 主数据导入（机场、城市）没有进行、或整体回滚了、换个时间再运行即可的情况。两种导入共用同一组错误码。 */
export type MasterImportErrorCode =
  /** 另一次同类导入正在运行 */
  | "IMPORT_ALREADY_RUNNING"
  /** 导入期间有人在后台新增了编码相同的记录 */
  | "IMPORT_CODE_CONFLICT";

export class MasterImportError extends Error {
  readonly code: MasterImportErrorCode;
  constructor(code: MasterImportErrorCode, message: string) {
    super(message);
    this.name = "MasterImportError";
    this.code = code;
  }
}
