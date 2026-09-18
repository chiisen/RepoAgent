import type { Repo } from '../types';
import { RepoCard } from './RepoCard';

type Props = {
  repos: Repo[];
  pullingId: string | null;
  onDetail: (id: string) => void;
  onPull: (id: string) => void;
  onOpt: (id: string, name: string) => void;
};

export function RepoGrid({ repos, pullingId, onDetail, onPull, onOpt }: Props) {
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
          busy={pullingId === r.id}
          onDetail={() => onDetail(r.id)}
          onPull={() => onPull(r.id)}
          onOpt={() => onOpt(r.id, r.name)}
        />
      ))}
    </div>
  );
}
