import { z } from "zod";

export type NutritionArticle = {
  url: string;
  title: string;
  format: "blog" | "article" | "video";
  publisher: string;
  summary: string;
  topic: "식단·레시피" | "장보기·외식" | "실천 경험" | "전문가 설명";
  platform: "naver" | "youtube" | "other";
  verification: "content" | "preview";
};
export type NutritionExploration = { articles: NutritionArticle[]; retrievedAt: string };
export const MAX_NUTRITION_RESOURCES = 8;

export const nutritionExplorationRequest = z.object({
  conditionId: z.string().trim().min(1).max(200),
}).strict();

// Selection checks remain server-side; the reader sees only a short explanation and link.
export const nutritionArticleSchema = z.object({
  url: z.string().max(2000),
  title: z.string().trim().min(1).max(150),
  format: z.enum(["blog", "article", "video"]),
  summary: z.string().trim().min(1).max(240),
  topic: z.enum(["식단·레시피", "장보기·외식", "실천 경험", "전문가 설명"]),
  access: z.enum(["content", "preview"]),
});

export function publicArticleUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
    const host = url.hostname.toLowerCase();
    if (!host.includes(".") || host.endsWith(".local") || host.endsWith(".localhost") ||
      host.endsWith(".internal") || /^[\d.]+$/.test(host) || host.includes(":")) return null;
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_|fbclid$|gclid$)/i.test(key)) url.searchParams.delete(key);
    }
    if (host === "blog.naver.com" || host === "m.blog.naver.com") {
      const path = /^\/([a-zA-Z0-9_-]+)\/(\d+)\/?$/.exec(url.pathname);
      const blogId = path?.[1] ?? url.searchParams.get("blogId");
      const logNo = path?.[2] ?? url.searchParams.get("logNo");
      if (!blogId || !/^[a-zA-Z0-9_-]+$/.test(blogId) || !logNo || !/^\d+$/.test(logNo)) return null;
      return `https://blog.naver.com/${blogId}/${logNo}`;
    }
    if (host === "cafe.naver.com" || host === "m.cafe.naver.com") {
      const pathMatch = /\/cafes\/(\d+)\/articles\/(\d+)/.exec(url.pathname);
      const clubId = pathMatch?.[1] ?? url.searchParams.get("clubid") ?? url.searchParams.get("clubId");
      const articleId = pathMatch?.[2] ?? url.searchParams.get("articleid") ?? url.searchParams.get("articleId");
      if (!clubId || !articleId || !/^\d+$/.test(clubId) || !/^\d+$/.test(articleId)) return null;
      return `https://cafe.naver.com/ca-fe/cafes/${clubId}/articles/${articleId}`;
    }
    // Search listings and platform home pages are not individual reading material.
    if (host === "search.naver.com" || host === "m.search.naver.com" || host === "naver.com" || host === "www.naver.com") return null;
    // A video shared using different YouTube URL forms is still one resource.
    if (host === "youtu.be" || host === "youtube.com" || host.endsWith(".youtube.com")) {
      const id = host === "youtu.be" ? url.pathname.slice(1) :
        url.pathname === "/watch" ? url.searchParams.get("v") :
          /^\/(shorts|live)\/([^/]+)$/.exec(url.pathname)?.[2];
      if (!id || !/^[\w-]{11}$/.test(id)) return null;
      return `https://www.youtube.com/watch?v=${id}`;
    }
    return url.href;
  } catch { return null; }
}

/** Search provenance and model selection signals are filters, not a clinical review. */
export function validateNutritionArticles(payload: unknown, sourceUrls: string[], conditionName: string): NutritionArticle[] {
  const parsed = z.object({ articles: z.array(z.unknown()).max(MAX_NUTRITION_RESOURCES) }).safeParse(payload);
  if (!parsed.success) throw new Error("Invalid nutrition search response");
  const sources = new Set(sourceUrls.map(publicArticleUrl).filter(Boolean));
  const seen = new Set<string>();
  const seenTitles = new Set<string>();
  const conditionKey = conditionName.normalize("NFKC").toLowerCase().replace(/[^a-z0-9가-힣]/g, "");
  const result: NutritionArticle[] = [];
  for (const candidate of parsed.data.articles) {
    const item = nutritionArticleSchema.safeParse(candidate);
    if (!item.success) continue;
    const data = item.data;
    if (!/[가-힣]/.test(data.title) || !/[가-힣]/.test(data.summary)) continue;
    if (/캠페인|행사|모집|보도자료|예방관리사업|사업\s*개요|사업\s*소개/u.test(data.title)) continue;
    const relevanceText = `${data.title} ${data.summary}`.normalize("NFKC").toLowerCase().replace(/[^a-z0-9가-힣]/g, "");
    if (!conditionKey || !relevanceText.includes(conditionKey)) continue;
    if (/직접.{0,24}(않|아니)|(단독|주된|주요).{0,18}(관련|주제|대상).{0,12}(않|아니)|다른 질환 중심|관련성.{0,6}낮/u.test(data.summary)) continue;
    const url = publicArticleUrl(data.url);
    if (!url || !sources.has(url) || seen.has(url)) continue;
    const host = new URL(url).hostname;
    const titleKey = data.title.normalize("NFKC").toLowerCase().replace(/[^a-z0-9가-힣]/g, "");
    if (seenTitles.has(titleKey)) continue;
    const isVideo = host === "www.youtube.com";
    const isNaver = host === "naver.com" || host.endsWith(".naver.com");
    if ((data.format === "video") !== isVideo) continue;
    const verification = data.access;
    seen.add(url);
    seenTitles.add(titleKey);
    const platform = isVideo ? "youtube" : isNaver ? "naver" : "other";
    result.push({ url, title: data.title, format: data.format, summary: data.summary, topic: data.topic, platform,
      verification,
      publisher: isVideo ? "유튜브" : /(^|\.)blog\.naver\.com$/.test(host) ? "네이버 블로그" :
        host.endsWith(".tistory.com") ? "티스토리" : host.replace(/^www\./, "") });
  }
  return result.slice(0, MAX_NUTRITION_RESOURCES);
}
