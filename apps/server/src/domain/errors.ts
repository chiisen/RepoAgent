/**
 * Domain — 領域錯誤型別（純資料）。
 */

export class DomainError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = 'DomainError';
  }
}

export class RepoNotFoundError extends DomainError {
  constructor(id: string) {
    super('repo_not_found', `repo not found: ${id}`);
  }
}

export class JobNotFoundError extends DomainError {
  constructor(id: string) {
    super('job_not_found', `job not found: ${id}`);
  }
}

export class RootDirNotFoundError extends DomainError {
  constructor(path: string) {
    super('root_dir_not_found', `rootDir not found: ${path}`);
  }
}

export class InvalidPromptError extends DomainError {
  constructor(message: string) {
    super('invalid_prompt', message);
  }
}

export class InvalidSkipDirsError extends DomainError {
  constructor(message: string) {
    super('invalid_skip_dirs', message);
  }
}

export class PiAlreadyRunningError extends DomainError {
  readonly jobId: string;
  constructor(jobId: string) {
    super('pi_already_running', `此專案已有優化執行中（job ${jobId}）`);
    this.jobId = jobId;
  }
}

export class PiConcurrencyLimitError extends DomainError {
  readonly limit: number;
  constructor(limit: number) {
    super('pi_concurrency_limit', `已達 pi 併發上限（${limit}）`);
    this.limit = limit;
  }
}
