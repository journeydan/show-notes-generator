import { Component } from "react";

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }
  componentDidCatch(error, info) {
    console.error("ErrorBoundary caught:", error, info);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="app" style={{ textAlign: "center", padding: "80px 24px" }}>
          <div className="eyebrow">⚠ Something went wrong</div>
          <h1 style={{ fontSize: 28 }}>Show Notes<br /><span>Generator</span></h1>
          <p style={{ color: "#666", marginTop: 16, maxWidth: 400, margin: "16px auto" }}>
            An unexpected error occurred. Your drafts are saved in your browser.
          </p>
          <button
            className="btn-primary"
            style={{ marginTop: 24 }}
            onClick={() => { this.setState({ hasError: false, error: null }); window.location.reload(); }}
          >
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
