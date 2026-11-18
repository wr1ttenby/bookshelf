// 노션 데이터베이스를 읽어 site/books.json 을 만드는 스크립트
// 실행: NOTION_TOKEN=... NOTION_DATABASE_ID=... node scripts/fetch-notion.mjs
// Node 18 이상이면 추가 설치 없이 실행됩니다.

import { writeFile } from "node:fs/promises";

const TOKEN = process.env.NOTION_TOKEN;
const DATABASE_ID = (process.env.NOTION_DATABASE_ID || "").replace(/-/g, "").match(/[0-9a-f]{32}/i)?.[0];
const OUT = new URL("../site/books.json", import.meta.url);
const NOTION_VERSION = "2025-09-03";

// 연도별 목표 권수 (없으면 진행 막대가 표시되지 않음)
const GOALS = { 2026: 30 };

// 데이터베이스 속성 이름 — 노션에서 이름을 바꾸면 여기도 같이 바꿔 주세요
const P = {
  title: "제목",
  year: "연도",
  order: "순서",
  genre: "분야",
  author: "저자",
  publisher: "출판사",
  date: "발행연월",
  pages: "쪽수",
  price: "가격",
  memo: "감상",
  quotes: "밑줄",
  summary: "200자 요약",
  show: "서가에 꽂기",
};

if (!TOKEN || !DATABASE_ID) {
  console.error("NOTION_TOKEN 과 NOTION_DATABASE_ID 환경 변수가 필요해요.");
  process.exit(1);
}

const HL0 = "\u0001", HL1 = "\u0002"; // 굵게 표시한 글자 → 사이트에서 형광펜 강조
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function notion(path, { method = "GET", body } = {}, attempt = 0) {
  const res = await fetch(`https://api.notion.com/v1/${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Notion-Version": NOTION_VERSION,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 429 || res.status >= 500) {
    if (attempt >= 4) throw new Error(`노션 API ${res.status}: ${await res.text()}`);
    const wait = Number(res.headers.get("retry-after") || 1) * 1000 + attempt * 500;
    await sleep(wait);
    return notion(path, { method, body }, attempt + 1);
  }
  if (!res.ok) {
    const text = await res.text();
    if (res.status === 404) throw new Error("데이터베이스를 찾을 수 없어요. 데이터베이스 ID가 맞는지, 데이터베이스에 통합(Connection)을 추가했는지 확인해 주세요.\n" + text);
    if (res.status === 401) throw new Error("토큰이 올바르지 않아요. NOTION_TOKEN 을 확인해 주세요.\n" + text);
    throw new Error(`노션 API ${res.status}: ${text}`);
  }
  return res.json();
}

// ── 속성 읽기 ─────────────────────────────────────
function richToText(rich = []) {
  return rich
    .map((r) => {
      const t = r.plain_text ?? r.text?.content ?? "";
      return r.annotations?.bold && t.trim() ? HL0 + t + HL1 : t;
    })
    .join("")
    .replace(/\u0002\u0001/g, ""); // 이어진 굵은 글씨는 하나로
}
function prop(page, name, { marks = false } = {}) {
  const p = page.properties?.[name];
  if (!p) return null;
  switch (p.type) {
    case "title":
    case "rich_text": {
      const t = richToText(p[p.type]);
      return (marks ? t : t.replace(/[\u0001\u0002]/g, "")).trim() || null;
    }
    case "number": return p.number;
    case "select": return p.select?.name ?? null;
    case "multi_select": return p.multi_select.map((s) => s.name).join(", ") || null;
    case "checkbox": return p.checkbox;
    case "date": return p.date?.start ?? null;
    case "formula": return p.formula?.[p.formula?.type] ?? null;
    default: return null;
  }
}

function groupOf(genre = "") {
  if (/^시(·|\s|$)/.test(genre)) return "시";
  if (/소설/.test(genre)) return "소설";
  if (/예술|패션|영화|미술|음악/.test(genre)) return "예술";
  if (/인문|비평|자기계발|철학|역사|사회|과학/.test(genre)) return "인문";
  return "에세이";
}
function pageRef(text) {
  const m = text.match(/\(\s*p\.\s*(\d+)\s*\)/i);
  return m ? { t: text.replace(m[0], "").trim(), p: "p." + m[1] } : { t: text.trim() };
}
function formatDate(v) {
  if (!v) return null;
  const m = String(v).match(/^(\d{4})-(\d{2})/);
  return m ? `${m[1]}년 ${Number(m[2])}월` : String(v);
}
function formatPrice(v) {
  if (v == null) return null;
  return typeof v === "number" ? v.toLocaleString("ko-KR") + "원" : String(v);
}
function pickQuotes(list, max = 3) {
  const ranked = list.map((q, i) => ({ q, i, hl: q.t.includes(HL0) ? 1 : 0 }));
  return ranked
    .sort((a, b) => b.hl - a.hl || a.i - b.i)
    .slice(0, max)
    .sort((a, b) => a.i - b.i)
    .map(({ q }) => {
      const plain = q.t.replace(/[\u0001\u0002]/g, "");
      if (plain.length <= 260) return q;
      const m = q.t.match(/\u0001([\s\S]*?)\u0002/);
      return { ...q, t: m ? `… ${HL0}${m[1]}${HL1} …` : plain.slice(0, 240) + "…" };
    });
}

// ── 페이지 본문 읽기 (밑줄/감상 속성이 비어 있을 때) ─────────
async function pageBody(pageId) {
  const blocks = [];
  let cursor;
  do {
    const r = await notion(`blocks/${pageId}/children?page_size=100${cursor ? `&start_cursor=${cursor}` : ""}`);
    for (const b of r.results) {
      blocks.push(b);
      // 토글 안의 내용도 읽기 (한 단계)
      if (b.has_children && ["toggle", "callout", "heading_1", "heading_2", "heading_3"].includes(b.type)) {
        const c = await notion(`blocks/${b.id}/children?page_size=100`);
        blocks.push(...c.results.map((x) => ({ ...x, _parent: b })));
      }
    }
    cursor = r.has_more ? r.next_cursor : null;
  } while (cursor);

  const quotes = [], paras = [];
  for (const b of blocks) {
    const rich = b[b.type]?.rich_text;
    if (!rich) continue;
    const text = richToText(rich).trim();
    if (!text) continue;
    const parentLabel = b._parent ? richToText(b._parent[b._parent.type]?.rich_text || []) : "";
    if (/200자/.test(parentLabel)) continue; // 요약 토글은 속성으로 관리
    if (["bulleted_list_item", "numbered_list_item", "quote"].includes(b.type)) quotes.push(pageRef(text));
    else if (b.type === "paragraph") paras.push(text.replace(/[\u0001\u0002]/g, ""));
  }
  return { quotes, memo: paras.join("\n") || null };
}

// ── 메인 ─────────────────────────────────────────
async function main() {
  const db = await notion(`databases/${DATABASE_ID}`);
  const dataSourceId = db.data_sources?.[0]?.id;
  if (!dataSourceId) throw new Error("데이터베이스에서 데이터 소스를 찾지 못했어요.");

  const pages = [];
  let cursor;
  do {
    const r = await notion(`data_sources/${dataSourceId}/query`, {
      method: "POST",
      body: { page_size: 100, start_cursor: cursor },
    });
    pages.push(...r.results.filter((p) => p.object === "page" && !p.in_trash && !p.archived));
    cursor = r.has_more ? r.next_cursor : null;
  } while (cursor);

  const books = [];
  for (const page of pages) {
    if (prop(page, P.show) === false) continue; // '서가에 꽂기' 체크 해제한 책은 제외
    const title = prop(page, P.title);
    const year = prop(page, P.year);
    if (!title || !year) continue;

    const genre = prop(page, P.genre) || "기타";
    const book = {
      title,
      author: prop(page, P.author) || "",
      publisher: prop(page, P.publisher),
      date: formatDate(prop(page, P.date)),
      pages: prop(page, P.pages) || 200,
      price: formatPrice(prop(page, P.price)),
      genre,
      group: groupOf(genre),
      memo: prop(page, P.memo),
      summary: prop(page, P.summary),
      _year: String(year),
      _order: prop(page, P.order) ?? 9999,
      _created: page.created_time,
    };

    let quotes = (prop(page, P.quotes, { marks: true }) || "")
      .split(/\n\s*\n|\n(?=\s*[-•]\s)/)
      .map((q) => q.replace(/^\s*[-•]\s*/, "").trim())
      .filter(Boolean)
      .map(pageRef);

    // 속성이 비어 있으면 페이지 본문에서 읽기
    if (!quotes.length || !book.memo) {
      const body = await pageBody(page.id);
      if (!quotes.length) quotes = body.quotes;
      if (!book.memo) book.memo = body.memo;
    }

    if (quotes.length) book.quotes = pickQuotes(quotes);
    books.push(book);
  }

  const years = {};
  books
    .sort((a, b) => a._year.localeCompare(b._year) || a._order - b._order || a._created.localeCompare(b._created))
    .forEach((b) => {
      const y = b._year;
      delete b._year; delete b._order; delete b._created;
      for (const k of Object.keys(b)) if (b[k] == null || b[k] === "") delete b[k];
      (years[y] ||= { goal: GOALS[y] ?? null, books: [] }).books.push(b);
    });

  await writeFile(OUT, JSON.stringify({ updatedAt: new Date().toISOString(), years }, null, 1));
  console.log(
    "books.json 생성 완료:",
    Object.entries(years).map(([y, v]) => `${y}년 ${v.books.length}권`).join(", ")
  );
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
