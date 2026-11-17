import { Component, type ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import { tr } from "../lib/i18n";

type Props = { name: string; children: ReactNode };
type State = { error: string | null };

/**
 * Keeps one broken widget from taking the whole desktop down with it: a render error (a bad
 * setting, say) shows a small note in that widget, and the widget retries when its props change.
 */
export class WidgetBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(e: unknown): State {
    return { error: e instanceof Error ? e.message : String(e) };
  }

  componentDidCatch(e: unknown) {
    console.error(`widget ${this.props.name}:`, e);
  }

  componentDidUpdate(prev: Props) {
    // New settings may fix it: try again.
    if (this.state.error && prev.children !== this.props.children) this.setState({ error: null });
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="flex h-full flex-col items-center justify-center gap-1 p-2 text-center text-xs text-amber-300" title={this.state.error}>
        <AlertTriangle size={16} />
        <span>{tr(`${this.props.name} gặp lỗi — kiểm tra cài đặt widget.`, `${this.props.name} failed — check the widget settings.`)}</span>
      </div>
    );
  }
}
