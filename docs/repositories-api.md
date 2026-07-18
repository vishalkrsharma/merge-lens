# Repositories API — Frontend Integration Guide

## Base URL

```
http://localhost:8080   (development)
https://merge-lens-backend.onrender.com   (production)
```

All requests must include cookies (the session cookie set by the auth flow). Use `credentials: 'include'` on every fetch call.

---

## Authentication

All endpoints require the user to be logged in via GitHub OAuth. Requests without a valid session cookie return `401 Unauthorized`.

> **Important — re-authorization:** If users see a `401` from any endpoint, their session token may have expired or may lack the required `repo` scope. Redirect them to re-login.

---

## Data shapes

### `Repository`

Returned by `GET /repositories`, `POST /repositories`, `PATCH /repositories/:id`, and `DELETE /repositories/:id`.

```ts
type Repository = {
  id: string;                  // cuid, e.g. "clxyz123..." — use as stable key
  owner: string;               // GitHub org or username, e.g. "vishalkrsharma"
  repo: string;                // repo name, e.g. "merge-lens-backend"
  installationId: number;      // GitHub App installation ID (internal, don't display)
  isActive: boolean;           // whether automatic PR reviews are enabled for this repo
  enabledAgents: AgentType[];  // agents active for this repo
  severityThreshold: Severity; // minimum severity to surface findings
  installedAt: string;         // ISO 8601 — when first added to MergeLens
  createdAt: string;
  updatedAt: string;
  userId: string;
};

type AgentType = 'bug' | 'security' | 'performance' | 'style';
type Severity  = 'low' | 'medium' | 'high';
```

### `AvailableRepository`

Returned by `GET /repositories/available`. Repos that exist on GitHub but are not yet in MergeLens.

```ts
type AvailableRepository = {
  id: number;              // GitHub's numeric repo ID — required for POST /repositories
  name: string;            // short name, e.g. "merge-lens-backend"
  fullName: string;        // "owner/repo" — required for POST /repositories
  private: boolean;
  description: string | null;
};
```

### `SyncResult`

Returned by `POST /repositories/sync`.

```ts
type SyncResult = {
  synced: true;
  removed: string[];   // "owner/repo" pairs deleted from MergeLens (lost GitHub App access)
  accessible: number;  // total repos currently accessible to the GitHub App
};
```

---

## Endpoints

### `GET /repositories`

List all repositories the user has added to MergeLens, ordered newest-first.

**Response `200`** — `Repository[]`

```json
[
  {
    "id": "clxyz123",
    "owner": "vishalkrsharma",
    "repo": "merge-lens-backend",
    "installationId": 456,
    "enabledAgents": ["bug", "security"],
    "severityThreshold": "medium",
    "isActive": true,
    "installedAt": "2026-06-06T10:00:00.000Z",
    "createdAt": "2026-06-06T10:00:00.000Z",
    "updatedAt": "2026-06-06T10:00:00.000Z",
    "userId": "user_abc"
  }
]
```

**Errors**

| Status | Meaning |
|--------|---------|
| `401`  | Unauthenticated |

---

### `GET /repositories/available`

List the user's GitHub repos that have **not** been added to MergeLens yet. Use this to populate the "Add Repository" picker. Makes a live call to GitHub's API — expect 1–2 s latency, show a skeleton.

**Response `200`** — `AvailableRepository[]`

```json
[
  {
    "id": 987654321,
    "name": "moonquake-visualized",
    "fullName": "vishalkrsharma/moonquake-visualized",
    "private": false,
    "description": "Moonquake data visualization"
  }
]
```

**Errors**

| Status | Meaning |
|--------|---------|
| `401`  | Unauthenticated |
| `404`  | GitHub account not linked — prompt re-login |
| `502`  | GitHub API error |

---

### `POST /repositories`

Add a GitHub repository to MergeLens. Grants the GitHub App access to the repo (for "Only select repositories" installations) and saves it to the database.

**Request body**

```json
{
  "repoId": 987654321,
  "fullName": "vishalkrsharma/moonquake-visualized"
}
```

| Field | Type | Source |
|-------|------|--------|
| `repoId` | `number` | `AvailableRepository.id` |
| `fullName` | `string` | `AvailableRepository.fullName` |

**Response `201`** — the created `Repository` object.

**Errors**

| Status | Meaning | What to show |
|--------|---------|--------------|
| `401`  | Token lacks permissions | "Please re-login to continue" |
| `404`  | GitHub App not installed, or access still not granted after the API call | Surface `error.message` — it tells the user to open GitHub App settings and add the repo manually, then retry |
| `502`  | GitHub API error | "GitHub is unavailable, try again" |

> **Why `404` can happen on add:** GitHub App installations set to "Only select repositories" require the user to explicitly grant each repo. MergeLens attempts this automatically via the GitHub API. If that call fails (permissions issue), the user must go to [github.com → Settings → Applications → MergeLens → Configure](https://github.com/settings/installations) and add the repo there manually before retrying.

---

### `POST /repositories/sync`

Reconcile MergeLens with the GitHub App installation. Removes any repos from the database that were revoked in GitHub App settings (e.g. user switched to "Only select repositories" and removed some repos).

Call this on page load alongside `GET /repositories` and refresh the list if `removed.length > 0`.

**Response `200`** — `SyncResult`

```json
{
  "synced": true,
  "removed": ["vishalkrsharma/moonquake-visualized"],
  "accessible": 2
}
```

**Errors**

| Status | Meaning |
|--------|---------|
| `401`  | Unauthenticated |
| `404`  | GitHub App not installed for this user |
| `502`  | GitHub API error |

---

### `PATCH /repositories/:id`

Update agent configuration for a connected repository. All body fields are optional — only include what you want to change.

**URL param** — `id`: `Repository.id`

**Request body**

```json
{
  "enabledAgents": ["bug", "security"],
  "severityThreshold": "medium",
  "isActive": false
}
```

| Field | Type | Values |
|-------|------|--------|
| `enabledAgents` | `AgentType[]` | `"bug"` `"security"` `"performance"` `"style"` — sends the **full replacement list** |
| `severityThreshold` | `Severity` | `"low"` `"medium"` `"high"` |
| `isActive` | `boolean` | `true` to enable PR reviews, `false` to pause them |

**Response `200`** — the updated `Repository` object.

**Errors**

| Status | Meaning |
|--------|---------|
| `401`  | Unauthenticated |
| `404`  | Repo not found or belongs to another user |

---

### `DELETE /repositories/:id`

Remove a repository from MergeLens. Does **not** revoke the GitHub App's access on GitHub's side.

**URL param** — `id`: `Repository.id`

**Response `200`** — the deleted `Repository` object.

**Errors**

| Status | Meaning |
|--------|---------|
| `401`  | Unauthenticated |
| `404`  | Repo not found or belongs to another user |

---

## Recommended page-load sequence

```
1. GET /repositories          → render list immediately
2. POST /repositories/sync    → run in parallel; if removed.length > 0, refresh list
```

Run both in parallel with `Promise.all`. The sync is a background correction — don't block the UI on it.

```ts
const [repos, sync] = await Promise.all([
  fetch("/repositories", { credentials: "include" }).then(r => r.json()),
  fetch("/repositories/sync", { method: "POST", credentials: "include" }).then(r => r.json()),
]);

let displayRepos: Repository[] = repos;

if (sync.removed?.length > 0) {
  // Remove stale entries from the already-fetched list
  const removedSet = new Set(sync.removed as string[]);
  displayRepos = repos.filter(
    (r: Repository) => !removedSet.has(`${r.owner}/${r.repo}`)
  );
}
```

---

## Add repository flow

```
1. User opens "Add Repository" modal
2. GET /repositories/available
   → on 404: "GitHub account not linked — please re-login"
   → on empty: "All your repos are already added to MergeLens"
3. User selects a repo from the list
4. POST /repositories { repoId, fullName }
   → disable button / show spinner
   → on 201: close modal, prepend returned repo to list, show success toast
   → on 404: surface error.message to user (likely asks them to visit GitHub App settings)
   → on 401: redirect to re-login
   → on 502: "GitHub unavailable, try again"
```

---

## Configure repository flow

```
1. User toggles agents or changes threshold in settings panel
2. PATCH /repositories/:id { enabledAgents?, severityThreshold? }
   → optimistic update the local state immediately
   → on error: revert local state and show error toast
3. On 200: replace local repo with the returned updated object
```

---

## Enable / disable PR reviews flow

```
1. User flips the "Automatic reviews" toggle on a repo
2. PATCH /repositories/:id { isActive: true | false }
   → optimistic update the toggle immediately
   → on error: revert toggle and show error toast
3. On 200: replace local repo with the returned updated object
```

When `isActive` is `false`, incoming `pull_request` webhooks for that repo are silently ignored — no review job is queued and no GitHub comment is posted. The repo record and all past reviews are preserved.

Newly added repositories default to `isActive: true`.

---

## Remove repository flow

```
1. User clicks "Remove" and confirms
2. DELETE /repositories/:id
   → on 200: remove from local list, show success toast
   → on 404: show error (already removed / page is stale — refresh)
```

---

## Agent and severity reference

| `AgentType`   | Reviews |
|---------------|---------|
| `bug`         | Logic errors, null dereferences, incorrect control flow |
| `security`    | Auth flaws, injection, hardcoded secrets, insecure patterns |
| `performance` | N+1 queries, expensive renders, unnecessary allocations |
| `style`       | Naming, formatting, dead code, readability |

| `Severity` | Behaviour |
|------------|-----------|
| `low`      | All findings are posted (default) |
| `medium`   | Only medium and high findings are posted |
| `high`     | Only high-severity findings are posted |

> `enabledAgents: []` means no agents run — show a warning in the UI but use `isActive: false` (not an empty agents list) as the canonical way to pause reviews.

---

## Display tips

- Split `fullName` on `/` to show `owner` and `repo` separately, or render as a `{owner}/{repo}` badge.
- `installedAt` is the canonical "added on" date to show in the UI — `createdAt` is the same value.
- Show a lock icon for `private: true` repos in the available-repos picker.
- `GET /repositories/available` only returns repos **owned** by the user (personal repos). Organization repos are not included.
