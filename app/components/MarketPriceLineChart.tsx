import { connectMarketTrend, describeMarketTrendPoint, summarizeMarketPriceTrend } from "../lib/market-prices/summary.ts";
import type { GarakMarketPrice } from "../lib/market-prices/types.ts";

const won = new Intl.NumberFormat("ko-KR");
const shortDate = (value: string) => `${Number(value.slice(4, 6))}/${Number(value.slice(6, 8))}`;
const dateValue = (value: string) => Date.UTC(Number(value.slice(0, 4)), Number(value.slice(4, 6)) - 1, Number(value.slice(6, 8)));

export default function MarketPriceLineChart({ rows, loading }: { rows: GarakMarketPrice[]; loading: boolean }) {
  if (loading) return <div className="marketTrendEmpty" role="status">최근 30일 실제 경매가를 불러오는 중입니다…</div>;
  if (rows.length === 0) return <div className="marketTrendEmpty">선택한 품종·등급·포장단위의 과거 가격이 없습니다.</div>;

  const summary = summarizeMarketPriceTrend(rows)!;
  const width = 720;
  const height = 280;
  const padding = { top: 24, right: 22, bottom: 30, left: 58 };
  const prices = rows.map((row) => row.averagePrice);
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);
  const pricePadding = Math.max((maxPrice - minPrice) * 0.15, maxPrice * 0.03, 1);
  const yMin = Math.max(0, minPrice - pricePadding);
  const yMax = maxPrice + pricePadding;
  const firstDay = dateValue(rows[0].priceDate);
  const lastDay = dateValue(rows.at(-1)!.priceDate);
  const daySpan = Math.max(lastDay - firstDay, 86_400_000);
  const x = (row: GarakMarketPrice) => padding.left + (dateValue(row.priceDate) - firstDay) / daySpan * (width - padding.left - padding.right);
  const y = (row: GarakMarketPrice) => padding.top + (yMax - row.averagePrice) / (yMax - yMin) * (height - padding.top - padding.bottom);
  const changeClass = summary.change == null ? "" : summary.change > 0 ? "marketTrendUp" : summary.change < 0 ? "marketTrendDown" : "";

  return <div className="marketTrend">
    <div className="marketTrendStats">
      <div><span>최근 가격</span><b>{won.format(summary.latest.averagePrice)}원</b><small>{shortDate(summary.latest.priceDate)}</small></div>
      <div><span>직전 거래일</span><b>{summary.previous ? `${won.format(summary.previous.averagePrice)}원` : "비교값 없음"}</b><small>{summary.previous ? shortDate(summary.previous.priceDate) : "-"}</small></div>
      <div className={changeClass}><span>직전 거래일 대비</span><b>{summary.change == null ? "-" : `${summary.change > 0 ? "+" : ""}${won.format(summary.change)}원`}</b><small>{summary.changeRate == null ? "비교값 없음" : `${summary.changeRate > 0 ? "+" : ""}${summary.changeRate}%`}</small></div>
    </div>
    <div className="marketLineChartWrap">
      <svg className="marketLineChart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${rows[0].itemName} ${rows[0].grade} ${rows[0].unitQuantity}kg 최근 30일 실제 평균가 선 차트`}>
        {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
          const gridY = padding.top + ratio * (height - padding.top - padding.bottom);
          const label = Math.round(yMax - ratio * (yMax - yMin));
          return <g key={ratio}><line x1={padding.left} x2={width - padding.right} y1={gridY} y2={gridY} className="marketChartGrid" /><text x={padding.left - 8} y={gridY + 4} textAnchor="end" className="marketChartAxis">{won.format(label)}</text></g>;
        })}
        <polyline points={connectMarketTrend(rows).map((row) => `${x(row)},${y(row)}`).join(" ")} className="marketChartLine" />
        {rows.map((row, index) => {
          const description = describeMarketTrendPoint(row, rows[index - 1] ?? null);
          return <circle key={row.id} cx={x(row)} cy={y(row)} r="5" className="marketChartPoint" tabIndex={0} role="button" aria-label={description}><title>{description}</title></circle>;
        })}
        <text x={padding.left} y={height - 8} className="marketChartAxis">{shortDate(rows[0].priceDate)}</text>
        <text x={width - padding.right} y={height - 8} textAnchor="end" className="marketChartAxis">{shortDate(rows.at(-1)!.priceDate)}</text>
      </svg>
    </div>
    <p className="marketTrendFootnote">가락시장 API의 실제 거래일 가격점만 실선으로 연결합니다. 거래 없는 날짜의 값은 만들지 않습니다.</p>
  </div>;
}
