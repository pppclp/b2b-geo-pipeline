import React from "react";

// Keep a failed import preview from blanking the entire application.
// This component does not retry writes or persist any selected file data.
export default class ImportErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { failed: false };
  }
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error) {
    console.error("Import screen failed to render", error);
  }
  render() {
    if (this.state.failed) {
      return (
        <section role="alert" className="mx-auto mt-12 max-w-xl rounded-xl border bg-background p-6">
          <h1 className="text-lg font-semibold">Import preview could not be displayed</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            No import has been confirmed from this screen. Return to Import and choose
            the file again, or reload the page. If this persists, contact the app administrator.
          </p>
          <button className="mt-4 rounded-lg border px-4 py-2 text-sm"
            onClick={() => this.setState({ failed: false })}>Try Again</button>
        </section>
      );
    }
    return this.props.children;
  }
}
