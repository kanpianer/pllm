import { renderMarkdown } from './markdown';

export interface RawComment {
  author: string;
  text: string;
  createdAt: string;
}

export type RelationType = 'quote' | 'email' | 'mention' | null;

export interface CommentNode {
  id: string;
  author: string;
  createdAt: string;
  relationType: RelationType;
  replyToAuthor: string | null;
  html: string;
  isPlaceholder: boolean;
  latestActivityTs: number;
  replyCount: number;
  children: CommentNode[];
}

interface ParsedComment {
  ownText: string;
  quoteText: string;
  shallowestQuoteText: string;
  quoteLevels: Array<{ depth: number; text: string }>;
  maxQuoteDepth: number;
  emailAuthor: string;
}

function normalizeForMatch(input: string): string {
  return (input || '')
    .replace(/!\[.*?\]\(.*?\)/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/^\s*(?:>\s*)+/gm, '')
    .replace(/^\d+\\?\.\s*/gm, '')
    .replace(/[`*_~]/g, '')
    .replace(/\s+/g, '')
    .toLowerCase();
}

function parseCommentText(rawText: string): ParsedComment {
  const lines = (rawText || '').replace(/\r\n/g, '\n').split('\n');
  const emailIdx = lines.findIndex(
    (l) =>
      /^.{0,80}(wrote:|写道：)\s*$/.test(l.trim()) ||
      /^\*[^*]+\*\s+left a comment/.test(l.trim())
  );

  let workLines = lines;
  let emailQuote = '';
  let emailAuthor = '';

  if (emailIdx !== -1) {
    const tail = lines.slice(emailIdx).join('\n');
    const mAuthor = tail.match(/\*([^*]+)\*\s+left a comment/);
    if (mAuthor) emailAuthor = mAuthor[1].trim();
    emailQuote = lines
      .slice(emailIdx)
      .filter((l) => l.trim().startsWith('>'))
      .map((l) => l.replace(/^\s*>\s?/, ''))
      .filter((l) => !/^\*[^*]+\*\s+left a comment/.test(l) && !/^<https?:\/\//.test(l) && l !== '—' && !/^Reply to this email/i.test(l))
      .join('\n')
      .trim();
    workLines = lines.slice(0, emailIdx);
  }

  let maxQuoteDepth = 0;
  const quoteLevels: Array<{ depth: number; text: string }> = [];
  const bodyLines: string[] = [];

  for (const line of workLines) {
    const m = line.match(/^(\s*(?:>\s*)+)(.*)$/);
    if (m) {
      const depth = (m[1].match(/>/g) || []).length;
      if (depth > maxQuoteDepth) maxQuoteDepth = depth;
      const content = m[2].trim();
      if (content) quoteLevels.push({ depth, text: content });
    } else {
      bodyLines.push(line);
    }
  }

  const ownText = bodyLines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  const shallowestQuoteText = quoteLevels
    .filter((q) => q.depth === 1)
    .map((q) => q.text.replace(/^\d+\\?\.\s*/, '').trim())
    .filter((t) => t && !/^>/.test(t) && !/^```/.test(t))
    .join(' ')
    .trim();

  const quoteText = quoteLevels.map((q) => q.text).join('\n') || emailQuote;

  return {
    ownText,
    quoteText,
    shallowestQuoteText: shallowestQuoteText || emailQuote,
    quoteLevels,
    maxQuoteDepth,
    emailAuthor,
  };
}

function hasSubstrMatch(a: string, b: string, minLen = 6): number {
  if (!a || !b || a.length < minLen || b.length < minLen) return 0;
  let best = 0;
  const step = Math.max(1, Math.floor(minLen / 2));
  for (let start = 0; start <= a.length - minLen; start += step) {
    const chunk = a.slice(start, start + Math.min(18, a.length - start));
    if (chunk.length >= minLen && b.includes(chunk)) {
      best = Math.max(best, chunk.length);
    }
  }
  return best;
}

function countDescendants(node: CommentNode): number {
  let count = 0;
  for (const child of node.children) {
    count += 1 + countDescendants(child);
  }
  return count;
}

function sortAndFinalize(nodes: CommentNode[]): number {
  let maxTs = 0;
  for (const node of nodes) {
    const childMax = node.children.length > 0 ? sortAndFinalize(node.children) : 0;
    node.latestActivityTs = Math.max(node.latestActivityTs, childMax);
    node.replyCount = countDescendants(node);
    if (node.latestActivityTs > maxTs) maxTs = node.latestActivityTs;
  }
  nodes.sort((a, b) => b.latestActivityTs - a.latestActivityTs);
  return maxTs;
}

/**
 * 将最多 100 条评论重建为“最新活动优先”的回复/引用树结构并渲染 Markdown。
 */
export async function buildCommentTree(rawComments: RawComment[], limit = 100): Promise<CommentNode[]> {
  if (!Array.isArray(rawComments) || rawComments.length === 0) return [];

  // 先按时间从新到旧截取最多 limit 条，再按时间正序重建引用/回复关系
  const limitedNewestFirst = [...rawComments]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, limit);

  const chronological = [...limitedNewestFirst].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  );

  interface WorkingItem {
    raw: RawComment;
    parsed: ParsedComment;
    ownNorm: string;
    quoteNorm: string;
    shallowNorm: string;
    parentIdx: number;
    relationType: RelationType;
  }

  const working: WorkingItem[] = chronological.map((raw) => {
    const parsed = parseCommentText(raw.text || '');
    return {
      raw,
      parsed,
      ownNorm: normalizeForMatch(parsed.ownText),
      quoteNorm: normalizeForMatch(parsed.quoteText),
      shallowNorm: normalizeForMatch(parsed.shallowestQuoteText),
      parentIdx: -1,
      relationType: null,
    };
  });

  for (let i = 0; i < working.length; i++) {
    const cur = working[i];

    // 1. 截断的多级引用链（无 ownText）：优先匹配上一层嵌套深度相同的父评论
    if (!cur.ownNorm && cur.parsed.maxQuoteDepth > 1 && cur.quoteNorm.length >= 10) {
      for (let j = i - 1; j >= 0; j--) {
        const cand = working[j];
        if (
          cand.parsed.maxQuoteDepth === cur.parsed.maxQuoteDepth - 1 &&
          hasSubstrMatch(cand.quoteNorm, cur.quoteNorm, 10) >= 10
        ) {
          cur.parentIdx = j;
          cur.relationType = 'quote';
          break;
        }
      }
    }

    // 2. 引用块匹配：优先用最浅层引用（直接回复对象）匹配最近的被引用评论
    if (cur.parentIdx === -1 && cur.quoteNorm.length >= 2) {
      if (cur.shallowNorm.length >= 2) {
        for (let j = i - 1; j >= 0; j--) {
          const cand = working[j];
          if (!cand.ownNorm) continue;
          const exactShort = cand.ownNorm.length >= 2 && cand.ownNorm.length < 6 && cur.shallowNorm.includes(cand.ownNorm);
          const fuzzyLong =
            cand.ownNorm.length >= 6 &&
            (hasSubstrMatch(cand.ownNorm, cur.shallowNorm, 6) >= 6 ||
              hasSubstrMatch(cur.shallowNorm, cand.ownNorm, 6) >= 6);
          if (exactShort || fuzzyLong) {
            cur.parentIdx = j;
            cur.relationType = 'quote';
            break;
          }
        }
      }

      // 回退到完整引用块匹配（仍从最近评论倒序查找，避免跨级连到祖父节点）
      if (cur.parentIdx === -1 && cur.quoteNorm.length >= 6) {
        for (let j = i - 1; j >= 0; j--) {
          const cand = working[j];
          if (
            cand.ownNorm.length >= 6 &&
            (hasSubstrMatch(cand.ownNorm, cur.quoteNorm, 6) >= 6 ||
              hasSubstrMatch(cur.quoteNorm, cand.ownNorm, 6) >= 6)
          ) {
            cur.parentIdx = j;
            cur.relationType = 'quote';
            break;
          }
        }
      }
    }

    // 3. 邮件回复头匹配（*username* left a comment）
    if (cur.parentIdx === -1 && cur.parsed.emailAuthor) {
      const targetAuthor = cur.parsed.emailAuthor.toLowerCase();
      for (let j = i - 1; j >= 0; j--) {
        if ((working[j].raw.author || '').toLowerCase() === targetAuthor) {
          cur.parentIdx = j;
          cur.relationType = 'email';
          break;
        }
      }
    }

    // 4. @username 提及匹配
    if (cur.parentIdx === -1) {
      const textToScan = cur.parsed.ownText || cur.raw.text || '';
      const mentions = [...textToScan.matchAll(/(?:^|[\s(（])@([a-zA-Z0-9-]+)/g)].map((m) =>
        m[1].toLowerCase()
      );
      if (mentions.length > 0) {
        for (let j = i - 1; j >= 0; j--) {
          if (mentions.includes((working[j].raw.author || '').toLowerCase())) {
            cur.parentIdx = j;
            cur.relationType = 'mention';
            break;
          }
        }
      }
    }
  }

  // 渲染 Markdown 并构造树节点（评论中仅展示自身回复正文，不展示引用原文）
  const nodes: CommentNode[] = await Promise.all(
    working.map(async (item, idx) => {
      const parentItem = item.parentIdx !== -1 ? working[item.parentIdx] : null;
      const rawTrimmed = (item.raw.text || '').trim();
      const displaySource = item.parsed.ownText;
      const isPlaceholder = displaySource.length === 0;

      const html = isPlaceholder
        ? rawTrimmed.length === 0
          ? '<p class="comment-placeholder">（仅包含图片或附件，请前往 GitHub 原帖查看）</p>'
          : '<p class="comment-placeholder">（回复正文被历史截断或仅含引用，请前往 GitHub 原帖查看）</p>'
        : await renderMarkdown(displaySource);

      const ts = new Date(item.raw.createdAt || 0).getTime() || 0;

      return {
        id: `c-${idx}`,
        author: item.raw.author || '匿名用户',
        createdAt: item.raw.createdAt || '',
        relationType: item.relationType,
        replyToAuthor: parentItem ? parentItem.raw.author || '匿名用户' : null,
        html,
        isPlaceholder,
        latestActivityTs: ts,
        replyCount: 0,
        children: [],
      };
    })
  );

  const roots: CommentNode[] = [];
  for (let i = 0; i < working.length; i++) {
    const pIdx = working[i].parentIdx;
    if (pIdx !== -1 && pIdx !== i && nodes[pIdx]) {
      nodes[pIdx].children.push(nodes[i]);
    } else {
      roots.push(nodes[i]);
    }
  }

  sortAndFinalize(roots);
  return roots;
}
