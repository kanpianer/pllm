import { createMarkdownProcessor, type MarkdownProcessor } from '@astrojs/markdown-remark';
import rehypeRaw from 'rehype-raw';

interface AstNode {
  type?: string;
  value?: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: AstNode[];
}

const ALLOWED_TAGS = new Set([
  'p',
  'br',
  'hr',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'strong',
  'b',
  'em',
  'i',
  'del',
  's',
  'code',
  'pre',
  'blockquote',
  'ul',
  'ol',
  'li',
  'a',
  'img',
  'table',
  'thead',
  'tbody',
  'tr',
  'th',
  'td',
  'details',
  'summary',
  'input',
  'span',
  'div',
]);

const SKIP_SOFT_BREAK_PARENTS = new Set(['code', 'html', 'table', 'tableRow', 'list', 'blockquote']);

function remarkSoftBreaks() {
  return (tree: AstNode) => {
    function walk(node: AstNode, inParagraph: boolean) {
      if (!node || !Array.isArray(node.children)) return;
      const insideParagraph = inParagraph || node.type === 'paragraph';
      for (let i = node.children.length - 1; i >= 0; i--) {
        const child = node.children[i];
        if (
          insideParagraph &&
          !SKIP_SOFT_BREAK_PARENTS.has(node.type || '') &&
          child.type === 'text' &&
          typeof child.value === 'string' &&
          child.value.includes('\n')
        ) {
          const parts = child.value.split(/\r?\n/);
          const replacement: AstNode[] = [];
          parts.forEach((part, idx) => {
            if (part) replacement.push({ type: 'text', value: part });
            if (idx < parts.length - 1) replacement.push({ type: 'break' });
          });
          node.children.splice(i, 1, ...replacement);
        } else {
          walk(child, insideParagraph);
        }
      }
    }
    walk(tree, false);
  };
}

function sanitizeRehype() {
  return (tree: AstNode) => {
    function visit(node: AstNode, parent: AstNode | null, idx: number) {
      if (!node) return;
      if (node.type === 'raw' || node.type === 'comment') {
        parent?.children?.splice(idx, 1);
        return;
      }
      if (node.type === 'element') {
        const tag = (node.tagName || '').toLowerCase();
        if (!ALLOWED_TAGS.has(tag)) {
          parent?.children?.splice(idx, 1);
          return;
        }
        const props = node.properties || {};
        const cleanProps: Record<string, unknown> = {};
        if (tag === 'a') {
          const href = String(props.href || '').trim();
          if (/^https?:\/\//i.test(href) || /^mailto:/i.test(href)) {
            cleanProps.href = href;
            cleanProps.target = '_blank';
            cleanProps.rel = 'noopener noreferrer';
          }
        } else if (tag === 'img') {
          const src = String(props.src || '').trim();
          if (/^https?:\/\//i.test(src)) {
            cleanProps.src = src;
            if (props.alt) cleanProps.alt = String(props.alt);
            cleanProps.loading = 'lazy';
          } else {
            parent?.children?.splice(idx, 1);
            return;
          }
        } else if (tag === 'input' && props.type === 'checkbox') {
          cleanProps.type = 'checkbox';
          cleanProps.disabled = true;
          if (props.checked) cleanProps.checked = true;
        } else if (tag === 'code' && props.className) {
          cleanProps.className = props.className;
        }
        node.properties = cleanProps;
      }
      if (Array.isArray(node.children)) {
        for (let i = node.children.length - 1; i >= 0; i--) {
          visit(node.children[i], node, i);
        }
      }
    }
    visit(tree, null, -1);
  };
}

let processorPromise: Promise<MarkdownProcessor> | null = null;

function getProcessor(): Promise<MarkdownProcessor> {
  if (!processorPromise) {
    processorPromise = createMarkdownProcessor({
      gfm: true,
      syntaxHighlight: false,
      remarkPlugins: [remarkSoftBreaks],
      rehypePlugins: [rehypeRaw as never, sanitizeRehype],
    });
  }
  return processorPromise;
}

/**
 * 将 GitHub Flavored Markdown 渲染为经过安全过滤的 HTML 字符串。
 */
export async function renderMarkdown(source: string): Promise<string> {
  if (!source) return '';
  const processor = await getProcessor();
  const { code } = await processor.render(source);
  return code;
}
