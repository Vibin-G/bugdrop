# Linear intake adapter

This fork keeps BugDrop's client-side capture and annotation interface while allowing
an authenticated application to submit feedback to a non-GitHub endpoint.

## Browser contract

Set these attributes on the locally hosted widget script:

```html
<script
  src="/vendor/bugdrop-linear/widget.js"
  data-provider="linear"
  data-repo="WanderCalm/Linear"
  data-submission-url="https://PROJECT.supabase.co/functions/v1/linear-feedback"
  data-auth-token-provider="WanderCalmFeedbackToken"
  data-allow-uploads="false"
  data-allow-console-logs="false"
  data-include-path="false"
  data-screenshot="optional"
></script>
```

`data-provider="linear"` disables the GitHub App installation check. The explicit
submission URL is used as-is. The endpoint must validate the caller; the widget does
not treat CORS as authentication.

The endpoint may return BugDrop's existing success envelope:

```json
{ "success": true, "isPublic": false }
```

Keeping `isPublic` false prevents the widget from exposing a private Linear issue URL
to end users. The host application controls whether paths, uploads, console logs, and
screenshots are available.

## Security boundary

- Bundle and serve the reviewed widget from the host application's own origin.
- Keep Linear credentials in a server-side endpoint only.
- Require a short-lived authenticated user session for every submission.
- Keep screenshots optional and user-reviewed.
- Treat visual masking as a privacy aid, not data-loss prevention.
- Apply server-side size limits, rate limits, route templating, and payload validation.
