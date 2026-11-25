import { Component } from 'react';

/** Catches render errors below it. Resets via the button, or when `resetKey` (the pathname) changes. */
export class ErrorBoundary extends Component {
  state = { error: null, resetKey: this.props.resetKey };

  static getDerivedStateFromError(error) {
    return { error };
  }

  static getDerivedStateFromProps(props, state) {
    if (props.resetKey !== state.resetKey) return { error: null, resetKey: props.resetKey };
    return null;
  }

  reset = () => this.setState({ error: null });

  render() {
    if (this.state.error) {
      return (
        <section className="error-fallback" role="alert">
          <h1>問題が発生しました</h1>
          <p>画面の表示中にエラーが起きました。もう一度お試しください。</p>
          <button type="button" onClick={this.reset}>
            再読み込み
          </button>
        </section>
      );
    }
    return this.props.children;
  }
}
