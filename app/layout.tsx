import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "담다 AI | 스마트스토어 상품 제작 도우미",
  description: "농산물 사진과 상품정보로 상세페이지와 상품등록 초안을 만듭니다.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ko"><body>{children}</body></html>;
}
