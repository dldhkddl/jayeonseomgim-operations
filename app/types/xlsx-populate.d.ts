declare module "xlsx-populate/browser/xlsx-populate.js" {
  type StyleValue = string | number | boolean | Record<string, string>;

  type Range = {
    value(value: Array<Array<string | number>>): Range;
    style(styles: Record<string, StyleValue>): Range;
  };

  type Row = {
    height(value: number): Row;
  };

  type Column = {
    width(value: number): Column;
  };

  type Sheet = {
    name(value: string): Sheet;
    range(address: string): Range;
    row(index: number): Row;
    column(name: string): Column;
    freezePanes(row: number, column: number): Sheet;
  };

  type Workbook = {
    sheet(index: number): Sheet;
    outputAsync(options: { type: "uint8array" }): Promise<Uint8Array>;
  };

  const XlsxPopulate: {
    fromBlankAsync(): Promise<Workbook>;
    fromDataAsync(data: Uint8Array, options: { password: string }): Promise<Workbook>;
  };

  export default XlsxPopulate;
}

declare module "xlsx-populate" {
  type Workbook = {
    outputAsync(options: { type: "nodebuffer"; password: string }): Promise<Buffer>;
  };

  const XlsxPopulate: {
    fromDataAsync(data: Uint8Array): Promise<Workbook>;
  };

  export default XlsxPopulate;
}
