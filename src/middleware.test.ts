import { beforeEach, describe, expect, it, vi } from "vitest";
import middleware from "@/middleware";

vi.mock("@clerk/nextjs/server", () => ({
  // Return the handler as-is so we can call it directly in tests
  clerkMiddleware: (handler: unknown) => handler,
  // Fake matcher: treat each pattern as a regex against the pathname
  createRouteMatcher: (patterns: string[]) => (request: Request) => {
    const { pathname } = new URL(request.url);
    return patterns.some((pattern) =>
      new RegExp(`^${pattern}$`).test(pathname),
    );
  },
}));

// clerkMiddleware is mocked, so the default export is really our own handler
const handler = middleware as unknown as (
  auth: unknown,
  request: Request,
) => Promise<Response | undefined>;

// Build a fake `auth`: callable, and it also has an `.protect` method
function makeAuth(role?: string) {
  const auth = vi.fn().mockResolvedValue({
    sessionClaims: role ? { metadata: { role } } : null,
  });
  const protect = vi.fn();
  return Object.assign(auth, { protect });
}

const requestFor = (path: string) => new Request(`http://localhost${path}`);

describe("middleware", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("/upload (admin only)", () => {
    it("redirects a signed-in non-admin to the home page", async () => {
      const auth = makeAuth("member");
      const response = await handler(auth, requestFor("/upload"));
      expect(response?.status).toBe(307);
      expect(response?.headers.get("location")).toBe("http://localhost/");
      expect(auth.protect).not.toHaveBeenCalled();
    });
    it("redirects a visitor without a session to the home page", async () => {
      const auth = makeAuth();
      const response = await handler(auth, requestFor("/upload"));
      expect(response?.headers.get("location")).toBe("http://localhost/");
    });
    it("lets an admin through, still requiring sign-in", async () => {
      const auth = makeAuth("admin");
      const response = await handler(auth, requestFor("/upload"));
      expect(response).toBeUndefined();
      expect(auth.protect).toHaveBeenCalledTimes(1);
    });
  });

  describe("public routes", () => {
    it.each([
      "/",
      "/sign-in",
      "/sign-in/factor-one",
      "/sign-out",
    ])("does not require sign-in for %s", async (path) => {
      const auth = makeAuth();
      const response = await handler(auth, requestFor(path));
      expect(response).toBeUndefined();
      expect(auth.protect).not.toHaveBeenCalled();
    });
  });

  describe("protected routes", () => {
    it.each([
      "/api/chat",
      "/chat",
      "/some/other/page",
    ])("requires sign-in for %s", async (path) => {
      const auth = makeAuth("member");
      await handler(auth, requestFor(path));
      expect(auth.protect).toHaveBeenCalledTimes(1);
    });
  });
});
