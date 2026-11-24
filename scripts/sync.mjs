#!/usr/bin/env node
/**
 * scripts/sync.mjs
 * 同步 GitHub limbopro/Paolujichang Issues 及用户评论到 src/data/issues.json
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const REPO = 'limbopro/Paolujichang';
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || '';
const OUTPUT_FILE = path.join(__dirname, '../src/data/issues.json');

async function fetchJSON(url) {
  const headers = {
    'User-Agent': 'paolu-dashboard-sync/1.0',
    'Accept': 'application/vnd.github+json',
  };
  if (GITHUB_TOKEN) {
    headers['Authorization'] = `Bearer ${GITHUB_TOKEN}`;
  }

  const res = await fetch(url, { headers });
  if (res.status === 403 || res.status === 429) {
    const reset = res.headers.get('x-ratelimit-reset');
    const resetTime = reset ? new Date(parseInt(reset, 10) * 1000).toLocaleTimeString() : '稍后';
    console.warn(`⚠️ GitHub API 达到访问限额 (HTTP ${res.status})，限额将于 ${resetTime} 重置。`);
    throw new Error(`Rate limit exceeded (${res.status})`);
  }
  if (!res.ok) {
    throw new Error(`GitHub API HTTP ${res.status}: ${res.statusText}`);
  }
  return res.json();
}

/**
 * 净化 Issue 正文：剔除末尾静态模板指引、须知说明以及未填写的空占位字段，只保留用户实际提交内容
 */
function cleanIssueBody(body = '') {
  if (!body) return '';

  let text = body;

  // 1. 切除说明指引与小贴士（从以下分隔标记处截断）
  const cutPatterns = [
    /\n---\s*\n\s*⚠️\s*以下.*?/i,
    /\n###?\s*⚠️?\s*提交\s*Issue\s*前请先确认[\s\S]*/i,
    /\n##\s*投稿与交流小贴士[\s\S]*/i,
    /\n###?\s*issue\s*\/?\s*留言模板参考[\s\S]*/i,
    /\n##\s*提交\s*issue\s*.*须知[\s\S]*/i,
    /\n##\s*细节补充[\s\S]*/i,
    /\n##\s*最后[\s\S]*/i,
    /\n\*\s*P\.S\.\s*千人千面[\s\S]*/i,
  ];

  for (const pat of cutPatterns) {
    const idx = text.search(pat);
    if (idx !== -1) {
      text = text.substring(0, idx);
    }
  }

  // 2. 清理顶部的模板提示语
  text = text
    .replace(/^请按.*?如实填写.*?(\n|$)/i, '')
    .replace(/^##\s*issue\s*详情说明.*?(\n|$)/i, '')
    .replace(/<!--[\s\S]*?-->/g, '');

  // 3. 移除未填写的纯空模板行（例如只有提示词，没有实际值的行）
  text = text
    .split('\n')
    .filter((line) => {
      const trimmed = line.trim();
      // 匹配只有字段名和括号提示，没有用户输入内容的行
      if (/^[🏷️🔗🔄⏳💰📖📊🕐⏱️📅📞💬📝📡💻📌\s]*\*\*[^*]+\*\*[：:]?\s*(（.*?）|\(.*?\))?\s*$/.test(trimmed)) {
        return false;
      }
      return true;
    })
    .join('\n')
    .trim();

  return text || '原贴未提供详细文字描述，请前往 GitHub 查看原贴讨论。';
}

function cleanSummary(cleanedBody = '') {
  if (!cleanedBody) return '原贴未提供文字描述';

  // 提取用户填写的有效信息
  const fields = [];
  const nameMatch = cleanedBody.match(/[\*🏷️\s]*机场名称[\*：:]+\s*([^\n]+)/);
  if (nameMatch && nameMatch[1].trim() && !nameMatch[1].includes('**')) {
    fields.push(`【机场】${nameMatch[1].trim()}`);
  }
  const expMatch = cleanedBody.match(/[\*📊\s]*机场当前使用体验[\*：:]+\s*([^\n]+)/);
  if (expMatch && expMatch[1].trim() && !expMatch[1].includes('**')) {
    fields.push(`【现状】${expMatch[1].trim()}`);
  }
  const daysMatch = cleanedBody.match(/[\*📅\s]*1周内的不可用天数[\*：:]+\s*([^\n]+)/);
  if (daysMatch && daysMatch[1].trim() && !daysMatch[1].includes('**')) {
    fields.push(`【不可用】${daysMatch[1].trim()}天`);
  }
  const noteMatch = cleanedBody.match(/[\*📌\s]*其他细节补充[\*：:]+\s*([^\n]+)/);
  if (noteMatch && noteMatch[1].trim() && !noteMatch[1].includes('**')) {
    fields.push(`【补充】${noteMatch[1].trim()}`);
  }

  // 净化其余文字作为摘要
  const cleanText = cleanedBody
    .replace(/!\[.*?\]\(.*?\)/g, '')
    .replace(/<img[^>]*>/gi, '')
    .replace(/^#+\s+/gm, '')
    .replace(/\*\*.*?\*\*/g, '')
    .replace(/\[(.*?)\]\(.*?\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();

  let summary = fields.join(' · ');
  if (!summary && cleanText.length > 5) {
    summary = cleanText.slice(0, 180);
  } else if (cleanText.length > 10 && summary.length < 80) {
    summary = `${summary} - ${cleanText.slice(0, 120)}`;
  }

  return (summary || cleanText || '原贴未提供文字摘要，请前往 GitHub 查看原贴。').slice(0, 220);
}

function detectRiskLevel(issue) {
  const state = (issue.state || '').toUpperCase();
  const labels = (issue.labels || []).map((l) => (typeof l === 'string' ? l : l.name || ''));
  const title = issue.title || '';

  // 1. 已关闭 Issue 处理
  if (state === 'CLOSED') {
    if (labels.some((l) => l.includes('误报') || l.includes('已恢复') || l.includes('正常') || l.includes('解决'))) {
      return 'resolved';
    }
    if (title.includes('误报') || title.includes('恢复') || title.includes('解除') || title.includes('解决')) {
      return 'resolved';
    }
    return 'archive';
  }

  // 2. 明确标记或标题为跑路
  if (
    labels.some((l) => l.includes('已跑路') || l.includes('跑路') || l.includes('runaway')) ||
    title.includes('已跑路') ||
    title.includes('跑路') ||
    title.includes('删库') ||
    title.includes('失联')
  ) {
    return 'high';
  }

  // 3. 预警 / 异常 / 观察中
  if (
    labels.some((l) => l.includes('预警') || l.includes('观察中') || l.includes('风险')) ||
    title.includes('预警') ||
    title.includes('观察') ||
    title.includes('断流') ||
    title.includes('全红') ||
    title.includes('超时') ||
    title.includes('风控')
  ) {
    return 'warning';
  }

  // 4. 误报或恢复
  if (labels.some((l) => l.includes('误报') || l.includes('已恢复'))) {
    return 'resolved';
  }

  return 'warning';
}

/**
 * 抓取仓库范围内的最新用户评论并按 Issue 归集
 */
async function fetchRepoComments(maxPages = 15) {
  console.log('💬 正在抓取社区最新用户评论...');
  const commentsByIssue = new Map();

  for (let page = 1; page <= maxPages; page++) {
    try {
      const url = `https://api.github.com/repos/${REPO}/issues/comments?per_page=100&sort=updated&direction=desc&page=${page}`;
      const batch = await fetchJSON(url);
      if (!Array.isArray(batch) || batch.length === 0) break;

      for (const c of batch) {
        if (!c.issue_url || !c.body) continue;
        const issueId = parseInt(c.issue_url.split('/').pop(), 10);
        if (Number.isNaN(issueId)) continue;

        if (!commentsByIssue.has(issueId)) {
          commentsByIssue.set(issueId, []);
        }

        const list = commentsByIssue.get(issueId);
        // 每个 issue 最多保留 15 条最新评论
        if (list.length < 15) {
          list.push({
            author: c.user?.login || '匿名用户',
            text: c.body
              .replace(/!\[.*?\]\(.*?\)/g, '')
              .replace(/<img[^>]*>/gi, '')
              .replace(/\r\n/g, '\n')
              .slice(0, 260)
              .trim(),
            createdAt: c.created_at || '',
          });
        }
      }
      await new Promise((r) => setTimeout(r, 150));
    } catch (err) {
      console.warn(`评论抓取第 ${page} 页跳过: ${err.message}`);
      break;
    }
  }

  console.log(`💬 已匹配到 ${commentsByIssue.size} 个 Issue 的最新用户评论。`);
  return commentsByIssue;
}

async function sync() {
  console.log('🚀 开始同步 limbopro/Paolujichang Issues...');
  if (GITHUB_TOKEN) {
    console.log('🔑 已检测到 GITHUB_TOKEN，使用鉴权模式');
  } else {
    console.log('⚠️ 未提供 GITHUB_TOKEN，使用匿名模式（受 60 次/小时限制）');
  }

  // 1. 抓取所有 Issue
  const rawIssues = [];
  let page = 1;

  while (true) {
    const url = `https://api.github.com/repos/${REPO}/issues?state=all&per_page=100&page=${page}`;
    console.log(`📥 正在拉取第 ${page} 页 Issue...`);

    let list;
    try {
      list = await fetchJSON(url);
    } catch (err) {
      console.warn(`第 ${page} 页抓取中断: ${err.message}`);
      break;
    }

    if (!Array.isArray(list) || list.length === 0) {
      console.log(`✅ 第 ${page} 页无更多数据，Issue 拉取完成。`);
      break;
    }

    rawIssues.push(...list);
    page++;
    if (page > 10) break;
    await new Promise((r) => setTimeout(r, 200));
  }

  const issuesOnly = rawIssues.filter((i) => !i.pull_request);
  console.log(`📊 共获取到 ${issuesOnly.length} 条有效 Issue 数据`);

  if (issuesOnly.length === 0 && fs.existsSync(OUTPUT_FILE)) {
    console.log('ℹ️ 未获取到新数据，保留原有的 issues.json 文件。');
    return;
  }

  // 1.5 读取已有数据以便继承历史评论
  const existingIssuesMap = new Map();
  if (fs.existsSync(OUTPUT_FILE)) {
    try {
      const prev = JSON.parse(fs.readFileSync(OUTPUT_FILE, 'utf8'));
      for (const item of prev) {
        existingIssuesMap.set(item.id, item);
      }
    } catch (e) {}
  }

  // 2. 抓取最新评论
  const commentsMap = await fetchRepoComments(GITHUB_TOKEN ? 20 : 10);

  // 3. 组装格式化数据
  const formattedIssues = issuesOnly.map((issue) => {
    const riskLevel = detectRiskLevel(issue);
    const cleanedBody = cleanIssueBody(issue.body || '');
    const summary = cleanSummary(cleanedBody);
    const labels = (issue.labels || []).map((l) => {
      let name = typeof l === 'string' ? l : l.name || '';
      if (name.includes('过久无人回应')) {
        name = '过久无人回应 💤';
      } else if (name.includes('问题已解决')) {
        name = '已解决 👌';
      } else if (name.includes('需要更多反馈')) {
        name = '需更多反馈 🤔';
      }

      return {
        name,
        color: typeof l === 'string' ? '666666' : l.color || '666666',
      };
    });

    const freshComments = commentsMap.get(issue.number) || [];
    const prevComments = existingIssuesMap.get(issue.number)?.latestComments || [];
    const mergedComments = [...freshComments];
    for (const pc of prevComments) {
      if (!mergedComments.some((fc) => fc.createdAt === pc.createdAt || fc.text === pc.text)) {
        mergedComments.push(pc);
      }
    }
    mergedComments.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    const comments = mergedComments.slice(0, 15);

    return {
      id: issue.number,
      title: issue.title || `Issue #${issue.number}`,
      state: (issue.state || 'open').toUpperCase(),
      url: issue.html_url || `https://github.com/${REPO}/issues/${issue.number}`,
      createdAt: issue.created_at || new Date().toISOString(),
      updatedAt: issue.updated_at || new Date().toISOString(),
      riskLevel,
      labels,
      summary,
      body: cleanedBody, // 仅包含用户提交的净有效内容，彻底剔除说明与模板规则
      commentCount: issue.comments || 0,
      reactionCount: issue.reactions?.total_count || 0,
      latestComments: comments,
    };
  });

  const outDir = path.dirname(OUTPUT_FILE);
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(formattedIssues, null, 2), 'utf8');
  console.log(`✅ 成功写入 ${formattedIssues.length} 条数据至 ${OUTPUT_FILE}`);
}

sync().catch((err) => {
  console.error('❌ 同步发生错误:', err);
  if (!fs.existsSync(OUTPUT_FILE)) {
    fs.mkdirSync(path.dirname(OUTPUT_FILE), { recursive: true });
    fs.writeFileSync(OUTPUT_FILE, '[]', 'utf8');
  }
});
