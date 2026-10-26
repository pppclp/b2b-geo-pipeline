import React from "react";

// Import preview failures must not blank the rest of the app.
// Never automatically retry a write after a render error.
export default class ImportErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { failed: false };
  }
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch() {
    // Do not log source/customer values from the failed preview.
    console.error("Import view rendering failed");
  }
  render() {
    if (this.state.failed) {
      return (
        <section role="alert" className="mx-auto mt-12 max-w-xl rounded-xl border bg-background p-6">
          <h1 className="text-lg font-semibold">Import preview could not be displayed</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            This error does not confirm an import. Return to Import and choose the source file again,
            or contact the administrator if the issue continues.
          </p>
          <button className="mt-4 rounded-lg border px-4 py-2 text-sm"
            onClick={() => this.setState({ failed: false })}>Try Again</button>
        </section>
      );
    }
    return this.props.children;
  }
}
