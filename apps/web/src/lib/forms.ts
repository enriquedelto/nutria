import type { FormEvent } from "react";

/**
 * onSubmit handler that reads the form like an action but does not reset it.
 * React 19 resets uncontrolled fields as soon as a form action returns; our actions only start a
 * transition, so a server error would wipe what the person typed.
 */
export const submitForm =
  (fn: (fd: FormData) => unknown) =>
  (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    fn(new FormData(e.currentTarget, (e.nativeEvent as SubmitEvent).submitter));
  };
