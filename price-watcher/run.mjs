#!/usr/bin/env node
// 주단가 워처 실행 진입점
//
// 사용법:
//   node run.mjs --prev <지난주.xlsx> --curr <이번주.xlsx> [--config config.json] [--out out]
//   node run.mjs --curr <이번주.xlsx>        (전주 파일 생략 시: --prev 없으면 out/latest.json 을 전주로 사용)
//
// 결과물(out 폴더):
//   change-report_<날짜>.md   변경 목록(사람용)
//   price-updates_<날짜>.csv  가격 반영용 목록
//   stock-actions_<날짜>.csv  품절/재개 처리 목록
//   latest.json               금주 스냅샷(다음 주 비교 기준)

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import xlsx from "xlsx";
import { parseWorkbook } from "./lib/parse.mjs";
import { diffWeeks } from "./lib/diff.mjs";
import { buildMarkdown, buildPriceCsv, buildStockCsv } from "./lib/report.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const a = {};
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i];
    if (k.startsWith("--")) {
      const key = k.slice(2);
      const val = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : true;
      a[key] = val;
    }
  }
  return a;
}

function loadConfig(p) {
  const raw = fs.readFileSync(p, "utf-8");
  return JSON.parse(raw);
}

function today() {
  const d = new Date();
  const z = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
}

/** Map -> 배열 (스냅샷 저장용) */
function snapshotFromRows(rows) {
  return [...rows.values()].map(({ raw, ...rest }) => rest);
}
/** 스냅샷 배열 -> Map (전주 기준 복원용) */
function rowsFromSnapshot(arr) {
  return new Map(arr.map((it) => [it.key, it]));
}

function main() {
  const args = parseArgs(process.argv);
  const configPath = path.resolve(__dirname, args.config || "config.json");
  const outDir = path.resolve(__dirname, args.out || "out");
  fs.mkdirSync(outDir, { recursive: true });

  const config = loadConfig(configPath);

  if (!args.curr) {
    console.error("오류: --curr <이번주.xlsx> 는 필수입니다.");
    process.exit(1);
  }

  const curParsed = parseWorkbook(path.resolve(process.cwd(), args.curr), config);
  const currRows = curParsed.rows;

  // 전주 데이터 확보: --prev 파일 우선, 없으면 저장된 스냅샷 사용
  let prevRows;
  const latestPath = path.join(outDir, "latest.json");
  if (args.prev) {
    prevRows = parseWorkbook(path.resolve(process.cwd(), args.prev), config).rows;
  } else if (fs.existsSync(latestPath)) {
    prevRows = rowsFromSnapshot(JSON.parse(fs.readFileSync(latestPath, "utf-8")).rows);
    console.log(`ℹ 전주 파일 미지정 → 저장된 스냅샷(${latestPath})을 전주로 사용`);
  } else {
    prevRows = new Map();
    console.log("ℹ 비교할 전주 데이터가 없어 전부 '신규'로 처리합니다(최초 실행).");
  }

  const diff = diffWeeks(prevRows, currRows, config);
  const dateLabel = today();

  // 리포트 생성
  const md = buildMarkdown(diff, config, dateLabel);
  const priceCsv = buildPriceCsv(diff, config);
  const stockCsv = buildStockCsv(diff);

  const mdPath = path.join(outDir, `change-report_${dateLabel}.md`);
  const pricePath = path.join(outDir, `price-updates_${dateLabel}.csv`);
  const stockPath = path.join(outDir, `stock-actions_${dateLabel}.csv`);

  fs.writeFileSync(mdPath, md, "utf-8");
  fs.writeFileSync(pricePath, "﻿" + priceCsv, "utf-8"); // BOM: 엑셀 한글 깨짐 방지
  fs.writeFileSync(stockPath, "﻿" + stockCsv, "utf-8");

  // 금주 스냅샷 저장(다음 주 비교 기준)
  fs.writeFileSync(
    latestPath,
    JSON.stringify({ date: dateLabel, file: args.curr, rows: snapshotFromRows(currRows) }, null, 2),
    "utf-8"
  );

  // 콘솔 요약
  const s = diff.summary;
  console.log("\n===== 주단가 변동 요약 =====");
  console.log(`전주 ${s.prevCount} → 금주 ${s.currCount} 품목`);
  console.log(`💰 공급가변동 ${s.priceChanged} · 🆕 신규 ${s.new} · ⚫ 단종 ${s.removed}`);
  console.log(`🔴 품절 ${s.soldOut} · 🟢 재입고 ${s.restocked} · 🟡 재고부족 ${s.lowStock}`);
  console.log("\n생성됨:");
  console.log(" -", mdPath);
  console.log(" -", pricePath);
  console.log(" -", stockPath);
  console.log(" -", latestPath, "(다음 주 비교 기준)");
}

main();
