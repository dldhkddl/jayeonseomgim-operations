import * as XLSX from "xlsx";

export async function decryptOfficeWorkbook(input: ArrayBuffer | Uint8Array, password: string, fileLabel = "엑셀 파일"): Promise<Uint8Array> {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  try {
    const workbook = XLSX.read(bytes, { type: "array", bookSheets: true });
    if (workbook.SheetNames.length > 0) return bytes;
  } catch {
    // 정상 파싱이 안 되는 파일만 암호화 여부를 추가로 확인합니다.
  }
  const marker = "EncryptionInfo";
  const hasEncryptionMarker = bytes.some((value, index) => marker.split("").every((character, offset) =>
    bytes[index + offset * 2] === character.charCodeAt(0) && bytes[index + offset * 2 + 1] === 0,
  ));
  if (!hasEncryptionMarker) return bytes;
  if (!password.trim()) throw new Error(`${fileLabel}은 암호화되어 있습니다. 비밀번호를 입력해 주세요.`);

  try {
    const xlsxPopulateModule = await import("xlsx-populate/browser/xlsx-populate.js");
    const workbook = await xlsxPopulateModule.default.fromDataAsync(bytes, { password });
    return await workbook.outputAsync({ type: "uint8array" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (/password|incorrect|verify/i.test(message)) throw new Error(`${fileLabel} 비밀번호가 맞지 않습니다. 다시 확인해 주세요.`);
    throw new Error(`${fileLabel} 비밀번호가 맞지 않거나 파일이 손상되었습니다. 비밀번호를 다시 확인해 주세요.`);
  }
}
