// 실제 농장 엑셀이 오기 전, 파이프라인 검증용 가짜 2주치 주단가표 생성.
// 실제 파일을 받으면 이 파일은 지워도 된다.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import xlsx from "xlsx";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(__dirname, "samples");
fs.mkdirSync(outDir, { recursive: true });

// 헤더는 일부러 '공급가' 대신 '주단가', 괄호/공백을 섞어 유연 파서를 시험한다.
const header = ["상품코드", "상품명", "규격", "주단가", "재고수량", "비고"];

const week01 = [
  header,
  ["A001", "포항 햇사과 부사", "3kg", 12000, 120, ""],
  ["A002", "성주 참외", "5kg", 18000, 40, ""],
  ["A003", "제주 감귤", "3kg", 9000, 0, "품절"],
  ["A004", "고령 딸기", "500g x 2", 15000, 15, ""],
  ["A005", "완주 대추방울토마토", "2kg", 11000, 80, ""],
  ["A006", "논산 양파", "10kg", 8000, 200, ""],
];

const week02 = [
  header,
  ["A001", "포항 햇사과 부사", "3kg", 13500, 90, ""],          // 공급가 인상
  ["A002", "성주 참외", "5kg", 16000, 5, ""],                 // 공급가 인하 + 재고부족(임계10 이하)
  ["A003", "제주 감귤", "3kg", 9000, 50, ""],                 // 재입고(품절->정상)
  ["A004", "고령 딸기", "500g x 2", 15000, 0, "품절"],         // 품절 전환
  // A005 완주 토마토: 이번 주 목록에서 사라짐(단종/누락)
  ["A006", "논산 양파", "10kg", 8000, 200, ""],               // 변동 없음
  ["A007", "해남 고구마", "5kg", 14000, 60, ""],              // 신규
];

function write(name, rows) {
  const ws = xlsx.utils.aoa_to_sheet(rows);
  const wb = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(wb, ws, "주단가");
  const p = path.join(outDir, name);
  xlsx.writeFile(wb, p);
  console.log("생성:", p);
}

write("week-01.xlsx", week01);
write("week-02.xlsx", week02);
