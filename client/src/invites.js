export function createInviteUrl(location, code) {
  const inviteUrl = new URL(location.href);
  inviteUrl.searchParams.set("join", code);
  inviteUrl.hash = "";
  return inviteUrl.toString();
}

export function readInviteCode(search) {
  return new URLSearchParams(search).get("join")?.trim().toUpperCase() ?? "";
}
