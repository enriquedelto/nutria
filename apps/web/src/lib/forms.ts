import type { FormEvent } from "react";

/**
 * onSubmit handler that reads the form like an action but does not reset it.
 * React 19 resets uncontrolled fields as soon as a form action returns; our actions only start a
 * transition, so a server error would wipe what the person typed.
 *
 * The form element comes as the second argument: call `form.reset()` after a successful save
 * (instead of a ref, which React Compiler flags as read during render).
 */
export const submitForm =
  (fn: (fd: FormData, form: HTMLFormElement) => unknown) =>
  (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    fn(new FormData(form, (e.nativeEvent as SubmitEvent).submitter), form);
  };
