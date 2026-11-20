import { Component } from 'react';

/** Keeps one broken screen from blanking the whole app. Shows a retry instead. */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('[studio] screen failed to render', error, info?.componentStack);
  }

  componentDidUpdate(prev) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null });
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="error-boundary" role="alert">
        <h2>This screen hit a problem</h2>
        <p>Your chats and results are saved. Try this screen again, or reload the page if it keeps happening.</p>
        <div className="error-boundary-actions">
          <button type="button" className="primary" onClick={() => this.setState({ error: null })}>
            Try again
          </button>
          <button type="button" className="ghost" onClick={() => window.location.reload()}>
            Reload page
          </button>
        </div>
      </div>
    );
  }
}
