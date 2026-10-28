import { NextResponse } from "next/server";

export const accessCookie = "dcp_access";
export const refreshCookie = "dcp_refresh";

export function setSession(response: NextResponse, accessToken: string, refreshToken: string) {
  const secure = process.env.NODE_ENV === "production";
  // Rolling window; the server still validates and renews the short-lived JWT.
  response.cookies.set(accessCookie, accessToken, { httpOnly: true, secure, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 30 });
  response.cookies.set(refreshCookie, refreshToken, { httpOnly: true, secure, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 30 });
  return response;
}

export function clearSession(response: NextResponse) {
  response.cookies.set(accessCookie, "", { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 0 });
  response.cookies.set(refreshCookie, "", { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 0 });
  return response;
}
