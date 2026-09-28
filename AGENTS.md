<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->
- AI allowance: visible usage = succeeded + in-flight provider-started runs (DB helpers only); a separate technical attempt ceiling (6 guest/session, 20 auth/month) counts every provider start. Why: quota means delivered analyses, while retries stay bounded.
