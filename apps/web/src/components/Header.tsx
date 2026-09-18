type Props = {
  rootDir: string;
  scanning: boolean;
  repoCount: number;
  q: string;
  filter: string;
  sort: string;
  onRootDir: (v: string) => void;
  onRootDirNorm: () => void;
  onScan: () => void;
  onQ: (v: string) => void;
  onFilter: (v: string) => void;
  onSort: (v: string) => void;
  onSettings: () => void;
  promptId: string;
  promptTemplates: { id: string; name: string }[];
  onPromptId: (v: string) => void;
};

export function Header(p: Props) {
  return (
    <header>
      <strong>RepoAgent</strong>
      <input
        id="rootDir"
        type="text"
        placeholder="貼上要掃的目錄，例如 D:\github\chiisen"
        spellCheck={false}
        value={p.rootDir}
        disabled={p.scanning}
        onChange={(e) => p.onRootDir(e.target.value)}
        onBlur={p.onRootDirNorm}
        onPaste={() => setTimeout(p.onRootDirNorm, 0)}
        onKeyDown={(ev) => {
          if (ev.key === 'Enter') {
            ev.preventDefault();
            p.onScan();
          }
        }}
      />
      <button id="btnScan" disabled={p.scanning} onClick={p.onScan}>
        {p.scanning ? (
          <>
            <i className="spin" />
            掃描中
          </>
        ) : (
          '掃描'
        )}
      </button>
      <button type="button" id="btnSettings" onClick={p.onSettings}>
        設定
      </button>
      {p.promptTemplates.length > 0 && (
        <select id="optPrompt" value={p.promptId} onChange={(e) => p.onPromptId(e.target.value)} title="優化樣板">
          {p.promptTemplates.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      )}
      <span id="repoCount">{p.repoCount} 個專案</span>
      <input id="q" placeholder="搜尋名稱" value={p.q} onChange={(e) => p.onQ(e.target.value)} />
      <select id="filter" value={p.filter} onChange={(e) => p.onFilter(e.target.value)}>
        <option value="all">全部</option>
        <option value="clean">乾淨</option>
        <option value="dirty">有變更</option>
      </select>
      <select id="sort" value={p.sort} onChange={(e) => p.onSort(e.target.value)}>
        <option value="name">名稱</option>
        <option value="lastCommitTime">最後 commit</option>
      </select>
    </header>
  );
}
