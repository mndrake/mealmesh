// App-level error boundary (M4): a render/runtime crash shows a friendly fallback with a
// reload instead of a blank white screen. Synced state is safe in Supabase + the local cache.
import { Component, type ReactNode } from "react";

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error("[mealmesh] uncaught render error:", error);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="error-fallback">
        <div className="error-card">
          <h2>Something went wrong</h2>
          <p className="muted">
            The app hit an unexpected error. Your plans and favorites are saved — reloading
            usually fixes it.
          </p>
          <button className="btn" onClick={() => window.location.reload()}>
            Reload
          </button>
        </div>
      </div>
    );
  }
}
