// Thin GitHub client for System Engineer. Read-only Octokit usage.
// Graceful degrade: missing PAT returns null with a reason.

import { Octokit } from '@octokit/rest';
import { env } from '../env';

let octokitCache: Octokit | null = null;

export function isGithubConfigured(): boolean {
  return !!env.github.pat;
}

function getOctokit(): Octokit | null {
  if (!env.github.pat) return null;
  if (octokitCache) return octokitCache;
  octokitCache = new Octokit({
    auth: env.github.pat,
    userAgent: 'artisanship-agents-system-engineer',
  });
  return octokitCache;
}

export interface TrackedRepo {
  /** Short nickname used in Finding IDs (agent-system | detto | tts | personal). */
  shortId: 'agent-system' | 'detto' | 'tts' | 'personal-site';
  /** Display label in the report */
  label: string;
  /** owner/repo slug — comes from env */
  slug: string | null;
  /** Priority per system-engineer playbook §4 */
  priority: 1 | 2;
}

export function getTrackedRepos(): TrackedRepo[] {
  return [
    {
      shortId: 'agent-system',
      label: 'Agent System / Dashboard',
      slug: env.github.repoAgentSystem ?? null,
      priority: 1,
    },
    {
      shortId: 'detto',
      label: 'Detto',
      slug: env.github.repoDetto ?? null,
      priority: 1,
    },
    {
      shortId: 'tts',
      label: 'The Trades Show site',
      slug: env.github.repoTTS ?? null,
      priority: 2,
    },
    {
      shortId: 'personal-site',
      label: 'Briana Augustina personal site',
      slug: env.github.repoPersonalSite ?? null,
      priority: 2,
    },
  ];
}

function parseSlug(slug: string): { owner: string; repo: string } | null {
  const parts = slug.split('/');
  if (parts.length !== 2) return null;
  return { owner: parts[0], repo: parts[1] };
}

export interface RepoCommit {
  sha: string;
  message: string;
  author: string | null;
  committed_at: string;
  url: string;
  additions: number | null;
  deletions: number | null;
  files_changed: number | null;
}

export async function listRepoCommitsSince(
  slug: string,
  sinceIso: string,
): Promise<{ ok: true; commits: RepoCommit[] } | { ok: false; error: string }> {
  const octokit = getOctokit();
  if (!octokit) return { ok: false, error: 'GITHUB_PAT not set' };
  const parsed = parseSlug(slug);
  if (!parsed) return { ok: false, error: `invalid repo slug: ${slug}` };
  try {
    const res = await octokit.repos.listCommits({
      owner: parsed.owner,
      repo: parsed.repo,
      since: sinceIso,
      per_page: 50,
    });
    const commits: RepoCommit[] = res.data.map((c) => ({
      sha: c.sha,
      message: c.commit.message.split('\n')[0],
      author: c.commit.author?.name ?? c.author?.login ?? null,
      committed_at: c.commit.author?.date ?? c.commit.committer?.date ?? '',
      url: c.html_url,
      additions: null,
      deletions: null,
      files_changed: null,
    }));
    return { ok: true, commits };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? String(e) };
  }
}

export interface PackageJsonSummary {
  name: string | null;
  version: string | null;
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
  scripts: Record<string, string>;
}

export async function getRepoPackageJson(
  slug: string,
): Promise<
  | { ok: true; pkg: PackageJsonSummary | null }
  | { ok: false; error: string }
> {
  const octokit = getOctokit();
  if (!octokit) return { ok: false, error: 'GITHUB_PAT not set' };
  const parsed = parseSlug(slug);
  if (!parsed) return { ok: false, error: `invalid repo slug: ${slug}` };
  try {
    const res = await octokit.repos.getContent({
      owner: parsed.owner,
      repo: parsed.repo,
      path: 'package.json',
    });
    if (Array.isArray(res.data) || !('content' in res.data)) {
      return { ok: true, pkg: null };
    }
    const content = Buffer.from(res.data.content, 'base64').toString('utf-8');
    const json = JSON.parse(content) as {
      name?: string;
      version?: string;
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
      scripts?: Record<string, string>;
    };
    return {
      ok: true,
      pkg: {
        name: json.name ?? null,
        version: json.version ?? null,
        dependencies: json.dependencies ?? {},
        devDependencies: json.devDependencies ?? {},
        scripts: json.scripts ?? {},
      },
    };
  } catch (e: any) {
    if (e?.status === 404) return { ok: true, pkg: null };
    return { ok: false, error: e?.message ?? String(e) };
  }
}

export interface RepoTopLevelSnapshot {
  default_branch: string;
  last_pushed_at: string | null;
  open_issues_count: number;
  languages: Record<string, number>;
  top_level_files: string[];
  has_ci: boolean;
  has_tests_dir: boolean;
  has_github_dir: boolean;
}

export async function getRepoSnapshot(
  slug: string,
): Promise<
  | { ok: true; snapshot: RepoTopLevelSnapshot }
  | { ok: false; error: string }
> {
  const octokit = getOctokit();
  if (!octokit) return { ok: false, error: 'GITHUB_PAT not set' };
  const parsed = parseSlug(slug);
  if (!parsed) return { ok: false, error: `invalid repo slug: ${slug}` };
  try {
    const [repoInfo, rootTree, languages] = await Promise.all([
      octokit.repos.get({ owner: parsed.owner, repo: parsed.repo }),
      octokit.repos.getContent({
        owner: parsed.owner,
        repo: parsed.repo,
        path: '',
      }),
      octokit.repos.listLanguages({ owner: parsed.owner, repo: parsed.repo }),
    ]);

    const rootEntries = Array.isArray(rootTree.data) ? rootTree.data : [];
    const top_level_files = rootEntries.map((e) => e.name);
    const hasCi =
      top_level_files.includes('.github') ||
      top_level_files.includes('.gitlab-ci.yml') ||
      top_level_files.includes('circle.yml');
    const hasTests =
      top_level_files.includes('tests') ||
      top_level_files.includes('__tests__') ||
      top_level_files.includes('test');

    return {
      ok: true,
      snapshot: {
        default_branch: repoInfo.data.default_branch,
        last_pushed_at: repoInfo.data.pushed_at,
        open_issues_count: repoInfo.data.open_issues_count,
        languages: languages.data as Record<string, number>,
        top_level_files,
        has_ci: hasCi,
        has_tests_dir: hasTests,
        has_github_dir: top_level_files.includes('.github'),
      },
    };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? String(e) };
  }
}

export async function getFileContent(
  slug: string,
  path: string,
): Promise<
  | { ok: true; content: string }
  | { ok: false; error: string }
> {
  const octokit = getOctokit();
  if (!octokit) return { ok: false, error: 'GITHUB_PAT not set' };
  const parsed = parseSlug(slug);
  if (!parsed) return { ok: false, error: `invalid repo slug: ${slug}` };
  try {
    const res = await octokit.repos.getContent({
      owner: parsed.owner,
      repo: parsed.repo,
      path,
    });
    if (Array.isArray(res.data) || !('content' in res.data)) {
      return { ok: false, error: 'not a file' };
    }
    return {
      ok: true,
      content: Buffer.from(res.data.content, 'base64').toString('utf-8'),
    };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? String(e) };
  }
}
