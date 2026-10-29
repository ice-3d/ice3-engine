import { execFileSync } from 'node:child_process';
import {
  access,
  readFile,
  readdir,
  stat,
} from 'node:fs/promises';
import {
  basename,
  dirname,
  extname,
  join,
  relative,
  resolve,
} from 'node:path';
import { fileURLToPath } from 'node:url';

const AREA_BY_REPOSITORY = {
  'ice3-agent-console': 'AGENT',
  'ice3-doc': 'DOC',
  'ice3-engine': 'ENG',
  'ice3-industrial': 'IND',
  'ice3-studio': 'STUDIO',
  'ice3-toolchain': 'TOOL',
  'ice3-water-demo': 'WATER',
};
const DOCUMENT_TYPES = new Set([
  'RM',
  'IDX',
  'ARC',
  'ADR',
  'GUIDE',
  'API',
  'SPEC',
  'PLAN',
  'POL',
  'CTR',
  'REF',
  'NOTICE',
]);
const STATUSES = new Set([
  'Draft',
  'Approved',
  'Active',
  'Implemented',
  'Historical',
  'Deprecated',
  'Placeholder',
]);
const DOCUMENT_ID_PATTERN =
  /^ICE3-(AGENT|DOC|ENG|IND|STUDIO|TOOL|WATER)-(RM|IDX|ARC|ADR|GUIDE|API|SPEC|PLAN|POL|CTR|REF|NOTICE)-(\d{3})$/;
const LOCAL_PATH_PATTERN =
  /(?:^|[\s`"'(])(\/(?:Users|home)\/[A-Za-z0-9._-]+\/|[A-Za-z]:\\Users\\[A-Za-z0-9._-]+\\)/;
const CROSS_REPOSITORY_PATTERN =
  /^https:\/\/github\.com\/ice-3d\/(ice3-(?:agent-console|doc|engine|industrial|studio|toolchain|water-demo))\/blob\/main\/(.+?)(?:#(.+))?$/;
const IGNORED_DIRECTORIES = new Set([
  '.git',
  '.playwright-cli',
  '.superpowers',
  'dist',
  'dist-example',
  'dist-example-m1',
  'node_modules',
  'playwright-report',
  'test-results',
]);

export async function checkRepository(root, options = {}) {
  const repositoryRoot = resolve(root);
  const expectedArea = options.expectedArea
    ?? AREA_BY_REPOSITORY[basename(repositoryRoot)];
  const workspaceRoot = options.workspaceRoot
    ? resolve(options.workspaceRoot)
    : undefined;
  const errors = [];
  const documents = [];
  for (const path of await markdownFiles(repositoryRoot)) {
    const source = await readFile(path, 'utf8');
    documents.push(parseDocument(path, source));
  }

  const ids = new Map();
  const titles = new Map();
  for (const document of documents) {
    const displayPath = relative(repositoryRoot, document.path);
    if (!document.title) {
      errors.push(`${displayPath}: missing level-one title`);
    } else if (titles.has(document.title)) {
      errors.push(
        `${displayPath}: duplicate title "${document.title}"`,
      );
    } else {
      titles.set(document.title, document.path);
    }
    if (!document.id) {
      errors.push(`${displayPath}: missing Document ID`);
    } else {
      const match = DOCUMENT_ID_PATTERN.exec(document.id);
      if (!match) {
        errors.push(`${displayPath}: invalid Document ID ${document.id}`);
      } else {
        if (expectedArea && match[1] !== expectedArea) {
          errors.push(
            `${displayPath}: area ${match[1]} does not match ${expectedArea}`,
          );
        }
        if (!DOCUMENT_TYPES.has(match[2])) {
          errors.push(`${displayPath}: invalid document type ${match[2]}`);
        }
        const previous = ids.get(document.id);
        if (previous) {
          errors.push(
            `${displayPath}: duplicate Document ID ${document.id}; first used by ${
              relative(repositoryRoot, previous)
            }`,
          );
        } else {
          ids.set(document.id, document.path);
        }
        if (
          match[2] === 'SPEC'
          && /\p{Script=Han}/u.test(document.source)
          && !/^>\s*English summary:\s*\S+/mu.test(document.source)
        ) {
          errors.push(`${displayPath}: Chinese specification lacks English summary`);
        }
      }
    }
    if (!document.status) {
      errors.push(`${displayPath}: missing Status`);
    } else if (!STATUSES.has(document.status)) {
      errors.push(`${displayPath}: unsupported Status ${document.status}`);
    }
    if (!document.owner) {
      errors.push(`${displayPath}: missing Owner`);
    }
    if (document.status === 'Placeholder' && document.hasCodeFence) {
      errors.push(
        `${displayPath}: Placeholder document contains executable content`,
      );
    }
    const localPath = LOCAL_PATH_PATTERN.exec(
      stripInlineCode(document.withoutInlineCode),
    );
    if (localPath) {
      errors.push(`${displayPath}: local absolute path ${localPath[1]}`);
    }
  }

  const index = documents.find((document) => (
    relative(repositoryRoot, document.path) === join('docs', 'README.md')
  ));
  const onlyPlaceholder = documents.length === 1
    && documents[0]?.status === 'Placeholder';
  if (!index && !onlyPlaceholder) {
    errors.push('docs/README.md: documentation index is required');
  }
  if (index) {
    const indexed = new Map();
    for (const link of index.links) {
      const target = resolveLinkTarget(index.path, link.href);
      if (!target || !target.startsWith(repositoryRoot)) continue;
      const key = target;
      indexed.set(key, (indexed.get(key) ?? 0) + 1);
    }
    for (const document of documents) {
      if (document.path === index.path) continue;
      const displayPath = relative(repositoryRoot, document.path);
      const count = indexed.get(document.path) ?? 0;
      if (count === 0) {
        errors.push(`${displayPath}: index does not link this document`);
      } else if (count > 1) {
        errors.push(`${displayPath}: index links this document ${count} times`);
      }
    }
  }

  const documentsByPath = new Map(
    documents.map((document) => [document.path, document]),
  );
  for (const document of documents) {
    for (const link of document.links) {
      const displayPath = relative(repositoryRoot, document.path);
      if (link.href.startsWith('http://') || link.href.startsWith('https://')) {
        if (!link.href.startsWith('https://github.com/ice-3d/')) continue;
        const match = CROSS_REPOSITORY_PATTERN.exec(link.href);
        if (!match) {
          errors.push(
            `${displayPath}: invalid cross-repository URL ${link.href}`,
          );
          continue;
        }
        if (workspaceRoot) {
          const localTarget = join(
            workspaceRoot,
            match[1],
            ...decodeURIComponent(match[2]).split('/'),
          );
          if (!(await fileExists(localTarget))) {
            errors.push(
              `${displayPath}: broken cross-repository link ${link.href}`,
            );
          }
        }
        continue;
      }
      if (link.href.startsWith('mailto:') || link.href.startsWith('tel:')) {
        continue;
      }
      if (link.href.startsWith('/')) {
        errors.push(`${displayPath}: local absolute link ${link.href}`);
        continue;
      }
      const target = resolveLinkTarget(document.path, link.href);
      if (!target || !(await fileExists(target))) {
        errors.push(`${displayPath}: broken relative link ${link.href}`);
        continue;
      }
      if (!target.startsWith(`${repositoryRoot}/`)) {
        errors.push(`${displayPath}: link escapes repository ${link.href}`);
        continue;
      }
      const targetDocument = documentsByPath.get(target);
      if (link.anchor && targetDocument) {
        const anchors = new Set(targetDocument.headings.map(headingSlug));
        if (!anchors.has(decodeURIComponent(link.anchor))) {
          errors.push(
            `${displayPath}: missing anchor ${link.href}`,
          );
        }
      }
    }
  }

  return {
    repository: basename(repositoryRoot),
    valid: errors.length === 0,
    documentCount: documents.length,
    errors,
  };
}

async function markdownFiles(root) {
  if (await pathExists(join(root, '.git'))) {
    const output = execFileSync(
      'git',
      ['ls-files', '-z', '--', '*.md'],
      { cwd: root, encoding: 'utf8' },
    );
    return output
      .split('\0')
      .filter((file) => file && !file.startsWith('scripts/fixtures/'))
      .map((file) => join(root, file));
  }
  const files = [];
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!IGNORED_DIRECTORIES.has(entry.name)) {
          await visit(join(directory, entry.name));
        }
      } else if (entry.isFile() && extname(entry.name) === '.md') {
        files.push(join(directory, entry.name));
      }
    }
  }
  await visit(root);
  return files
    .filter((file) => !relative(root, file).startsWith('scripts/fixtures/'))
    .sort();
}

function parseDocument(path, source) {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const visibleLines = [];
  let fence = false;
  let hasCodeFence = false;
  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) {
      fence = !fence;
      hasCodeFence = true;
      visibleLines.push('');
    } else {
      visibleLines.push(fence ? '' : line);
    }
  }
  const visible = visibleLines.join('\n');
  const headings = visibleLines
    .filter((line) => /^#{1,6}\s+/.test(line))
    .map((line) => line.replace(/^#{1,6}\s+/, '').trim());
  const h1Indices = visibleLines
    .map((line, index) => (/^#\s+\S/.test(line) ? index : -1))
    .filter((index) => index >= 0);
  const h1Index = h1Indices[0] ?? -1;
  const title = h1Index >= 0
    ? visibleLines[h1Index].replace(/^#\s+/, '').trim()
    : undefined;
  let metadata = '';
  if (h1Index >= 0) {
    let cursor = h1Index + 1;
    while (cursor < visibleLines.length && visibleLines[cursor] === '') cursor++;
    while (
      cursor < visibleLines.length
      && (visibleLines[cursor].startsWith('>') || visibleLines[cursor] === '')
    ) {
      if (visibleLines[cursor].length === 0) break;
      metadata += `${visibleLines[cursor]}\n`;
      cursor++;
    }
  }
  return {
    path,
    source,
    withoutInlineCode: visible.replace(/`[^`\n]*`/g, ''),
    title: h1Indices.length === 1 ? title : undefined,
    id: metadataValue(metadata, 'Document ID'),
    status: metadataValue(metadata, 'Status'),
    owner: metadataValue(metadata, 'Owner'),
    headings,
    links: markdownLinks(visible.replace(/`[^`\n]*`/g, '')),
    hasCodeFence,
  };
}

function metadataValue(metadata, field) {
  const match = new RegExp(`^>\\s*${field}:\\s*(.+?)\\s*$`, 'mu').exec(metadata);
  return match?.[1]?.trim();
}

function markdownLinks(content) {
  const links = [];
  const pattern = /(?<!!)\[[^\]]+\]\(([^)\s]+)(?:\s+["'][^"']*["'])?\)/g;
  for (const match of content.matchAll(pattern)) {
    const raw = match[1];
    if (!raw) continue;
    const [withoutAnchor, anchor] = raw.split('#', 2);
    links.push({
      href: raw,
      anchor: anchor || undefined,
      pathPart: withoutAnchor,
    });
  }
  return links;
}

function resolveLinkTarget(documentPath, href) {
  const pathPart = href.split('#', 1)[0]?.split('?', 1)[0];
  if (!pathPart) return documentPath;
  try {
    return resolve(dirname(documentPath), decodeURIComponent(pathPart));
  } catch {
    return undefined;
  }
}

function headingSlug(value) {
  return value
    .replace(/<[^>]*>/g, '')
    .replace(/[`*_~]/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

function stripInlineCode(value) {
  return value.replace(/`[^`\n]*`/g, '');
}

async function fileExists(path) {
  try {
    await access(path);
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

async function pathExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function parseArgs(argv) {
  const options = {
    root: process.cwd(),
    workspaceRoot: undefined,
    expectedArea: undefined,
    json: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--json') {
      options.json = true;
    } else if (argument === '--root' && argv[index + 1]) {
      options.root = argv[++index];
    } else if (argument === '--workspace-root' && argv[index + 1]) {
      options.workspaceRoot = argv[++index];
    } else if (argument === '--expected-area' && argv[index + 1]) {
      options.expectedArea = argv[++index];
    } else {
      throw new Error(`unknown documentation-check option: ${argument}`);
    }
  }
  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const roots = [];
  if (options.workspaceRoot) {
    for (const name of Object.keys(AREA_BY_REPOSITORY)) {
      const path = join(resolve(options.workspaceRoot), name);
      if (await pathExists(join(path, '.git'))) roots.push(path);
    }
  } else {
    roots.push(resolve(options.root));
  }
  const reports = [];
  for (const root of roots) {
    reports.push(await checkRepository(root, {
      ...(options.expectedArea ? { expectedArea: options.expectedArea } : {}),
      ...(options.workspaceRoot
        ? { workspaceRoot: resolve(options.workspaceRoot) }
        : {}),
    }));
  }
  const valid = reports.every((report) => report.valid);
  const output = reports.length === 1 ? reports[0] : { valid, reports };
  process.stdout.write(
    options.json
      ? `${JSON.stringify(output, null, 2)}\n`
      : `${reports.map((report) => (
        report.valid
          ? `${report.repository}: ${report.documentCount} documents valid`
          : `${report.repository}: ${report.errors.join('\n')}`
      )).join('\n')}\n`,
  );
  process.exitCode = valid ? 0 : 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
