/**
 * src/components/chat/__tests__/InputArea.test.tsx
 *
 * Tests for the InputArea component.
 * InputArea is purely presentational — no hooks, no fetch — so the default
 * jsdom environment is sufficient here.
 *
 * Why purely presentational: mirroring the MessageItem pattern keeps unit
 * tests fast and simple (no MSW, no renderHook). T10 wires isStreaming/
 * onSubmit/onStop from useStream; this file only tests the UI contract.
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { InputArea } from '../InputArea';

// ---------------------------------------------------------------------------
// Suite 1: submit behavior
// ---------------------------------------------------------------------------

describe('InputArea — submit on Enter', () => {
  it('calls onSubmit with the entered value when Enter is pressed', async () => {
    const onSubmit = jest.fn();
    render(<InputArea isStreaming={false} onSubmit={onSubmit} onStop={jest.fn()} />);

    await userEvent.type(screen.getByRole('textbox'), 'Hello{Enter}');

    expect(onSubmit).toHaveBeenCalledWith('Hello');
  });

  it('clears the textarea after submitting via Enter', async () => {
    render(<InputArea isStreaming={false} onSubmit={jest.fn()} onStop={jest.fn()} />);
    const textarea = screen.getByRole('textbox');

    await userEvent.type(textarea, 'Hello{Enter}');

    expect(textarea).toHaveValue('');
  });

  it('does not call onSubmit when Enter is pressed on an empty textarea', async () => {
    const onSubmit = jest.fn();
    render(<InputArea isStreaming={false} onSubmit={onSubmit} onStop={jest.fn()} />);

    await userEvent.type(screen.getByRole('textbox'), '{Enter}');

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('calls onSubmit with trimmed value (ignores leading/trailing whitespace)', async () => {
    const onSubmit = jest.fn();
    render(<InputArea isStreaming={false} onSubmit={onSubmit} onStop={jest.fn()} />);

    // userEvent.type does not support leading spaces well via '{Space}'; paste instead
    const textarea = screen.getByRole('textbox');
    await userEvent.click(textarea);
    await userEvent.paste('  hello  ');
    await userEvent.keyboard('{Enter}');

    expect(onSubmit).toHaveBeenCalledWith('hello');
  });

  it('calls onSubmit when the Send button is clicked', async () => {
    const onSubmit = jest.fn();
    render(<InputArea isStreaming={false} onSubmit={onSubmit} onStop={jest.fn()} />);

    await userEvent.type(screen.getByRole('textbox'), 'Hi there');
    await userEvent.click(screen.getByRole('button', { name: /send/i }));

    expect(onSubmit).toHaveBeenCalledWith('Hi there');
  });

  it('disables the Send button when the textarea is empty', () => {
    render(<InputArea isStreaming={false} onSubmit={jest.fn()} onStop={jest.fn()} />);

    expect(screen.getByRole('button', { name: /send/i })).toBeDisabled();
  });

  it('enables the Send button once text is entered', async () => {
    render(<InputArea isStreaming={false} onSubmit={jest.fn()} onStop={jest.fn()} />);

    await userEvent.type(screen.getByRole('textbox'), 'x');

    expect(screen.getByRole('button', { name: /send/i })).not.toBeDisabled();
  });
});

// ---------------------------------------------------------------------------
// Suite 2: Shift+Enter inserts newline
// ---------------------------------------------------------------------------

describe('InputArea — Shift+Enter inserts newline', () => {
  it('does not call onSubmit when Shift+Enter is pressed', async () => {
    const onSubmit = jest.fn();
    render(<InputArea isStreaming={false} onSubmit={onSubmit} onStop={jest.fn()} />);

    await userEvent.type(screen.getByRole('textbox'), 'Hello{Shift>}{Enter}{/Shift}');

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('inserts a newline into the textarea when Shift+Enter is pressed', async () => {
    render(<InputArea isStreaming={false} onSubmit={jest.fn()} onStop={jest.fn()} />);
    const textarea = screen.getByRole('textbox');

    await userEvent.type(textarea, 'line1{Shift>}{Enter}{/Shift}line2');

    expect(textarea).toHaveValue('line1\nline2');
  });
});

// ---------------------------------------------------------------------------
// Suite 3: Stop button visibility
// ---------------------------------------------------------------------------

describe('InputArea — Stop button visibility', () => {
  it('does not render the Stop button when not streaming', () => {
    render(<InputArea isStreaming={false} onSubmit={jest.fn()} onStop={jest.fn()} />);

    expect(screen.queryByRole('button', { name: /stop/i })).not.toBeInTheDocument();
  });

  it('renders the Stop button when streaming', () => {
    render(<InputArea isStreaming={true} onSubmit={jest.fn()} onStop={jest.fn()} />);

    expect(screen.getByRole('button', { name: /stop/i })).toBeInTheDocument();
  });

  it('calls onStop when the Stop button is clicked', async () => {
    const onStop = jest.fn();
    render(<InputArea isStreaming={true} onSubmit={jest.fn()} onStop={onStop} />);

    await userEvent.click(screen.getByRole('button', { name: /stop/i }));

    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it('hides the Send button while the Stop button is shown', () => {
    render(<InputArea isStreaming={true} onSubmit={jest.fn()} onStop={jest.fn()} />);

    // Stop replaces Send during streaming so the primary action is contextual
    expect(screen.queryByRole('button', { name: /send/i })).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Suite 4: disabled during streaming
// ---------------------------------------------------------------------------

describe('InputArea — disabled during streaming', () => {
  it('disables the Send button when isStreaming is true', () => {
    // Send button is not rendered during streaming (Stop takes its place),
    // but if it were, it should also be disabled. This test guards against
    // a regression where both buttons appear simultaneously.
    render(<InputArea isStreaming={true} onSubmit={jest.fn()} onStop={jest.fn()} />);

    // Send is absent during streaming — Stop is the only action button
    expect(screen.queryByRole('button', { name: /send/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /stop/i })).toBeInTheDocument();
  });

  it('does not call onSubmit when Enter is pressed during streaming', async () => {
    const onSubmit = jest.fn();
    render(<InputArea isStreaming={true} onSubmit={onSubmit} onStop={jest.fn()} />);

    await userEvent.type(screen.getByRole('textbox'), 'Hello{Enter}');

    expect(onSubmit).not.toHaveBeenCalled();
  });
});
