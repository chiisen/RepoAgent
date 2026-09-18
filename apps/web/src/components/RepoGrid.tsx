import type { Repo } from '../types';
import { RepoCard } from './RepoCard';

type Props = {
  repos: Repo[];
  pullingId: string | null;
  jobsByPath: Record<string, string>;
  onDetail: (id: string) => void;
  onPull: (id: string) => void;
  onOpt: (id: string, name: string, path: string) => void;
};

export function RepoGrid({ repos, pullingId, jobsByPath, onDetail, onPull, onOpt }: Props) {
  if (!repos.length) {
    return (
      <div className="grid" id="grid">
        <p style={{ padding: 16 }}>尚無專案，請先掃描。</p>
      </div>
    );
  }
  return (
    <div className="grid" id="grid">
      {repos.map((r) => (
        <RepoCard
          key={r.id}
          repo={r}
          busy={pullingId === r.id || !!jobsByPath[r.path]}
          onDetail={() => onDetail(r.id)}
          onPull={() => onPull(r.id)}
          onOpt={() => onOpt(r.id, r.name, r.path)}
        />
      ))}
    </div>
  );
}
