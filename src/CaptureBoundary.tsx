import { Component } from "react";
import type { ReactNode } from "react";
import Dialog from "./Dialog";

export default class CaptureBoundary extends Component<
  { children: ReactNode; onClose: () => void },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (this.state.failed)
      return (
        <Dialog title="Label tools could not load" onClose={this.props.onClose}>
          <p>
            Close this window to enter the item manually. To try camera or photo
            reading again, reconnect to the internet and reload the app.
          </p>
          <p className="hint">
            Your current entry and saved equipment are still available.
          </p>
          <div className="dialog-actions">
            <button className="button primary" onClick={this.props.onClose}>
              Return to entry
            </button>
          </div>
        </Dialog>
      );
    return this.props.children;
  }
}
