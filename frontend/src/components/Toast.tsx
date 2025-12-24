/**
 * Props for the Toast component.
 * @interface ToastProps
 * @property {string} message - The message to display in the toast
 */
interface ToastProps {
  message: string;
}

/**
 * A simple toast notification component.
 * Displays a brief message to the user, typically used for
 * confirming actions like copying or successful submissions.
 *
 * Note: The component does not handle its own visibility or timing.
 * Parent components should manage showing/hiding the toast.
 *
 * @component
 * @param {ToastProps} props - Component props
 * @returns {JSX.Element} The rendered toast notification
 *
 * @example
 * // Parent component manages toast state
 * {showToast && <Toast message="Address copied to clipboard" />}
 */
export function Toast({ message }: ToastProps) {
  return <div className="toast">{message}</div>;
}
