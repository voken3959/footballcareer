import { Component, type ReactNode } from 'react';
import { useStore } from '../store/store';

interface Props { children: ReactNode; resetKey?: string }
interface State { error: Error | null }

/** A render error in one screen should never take the whole career down with it. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State { return { error }; }

  componentDidCatch(error: Error) { console.error('Screen crashed:', error); }

  componentDidUpdate(prev: Props) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null });
  }

  render() {
    if (!this.state.error) return this.props.children;
    const st = useStore.getState();
    return (
      <div className="card mx-auto mt-10 max-w-xl p-6" role="alert">
        <h2 className="text-lg font-semibold text-ink-50">This screen hit a problem</h2>
        <p className="mt-2 text-sm text-ink-200">Your career is safe. The error was: <span className="font-mono text-bad-400">{this.state.error.message}</span></p>
        <div className="mt-4 flex flex-wrap gap-2">
          <button className="btn btn-primary" onClick={() => { st.go('home'); this.setState({ error: null }); }}>Back to Home</button>
          {st.game && <button className="btn" onClick={() => st.exportCareer()}>Export career</button>}
          <button className="btn" onClick={() => location.reload()}>Reload the game</button>
        </div>
      </div>
    );
  }
}
