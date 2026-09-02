import { clerkMiddleware } from "@clerk/nextjs/server";

export default clerkMiddleware(); // protects nothing; pages/routes call auth() themselves

export const config = {
  matcher: [
    "/((?!_next|\\.well-known/workflow/|eve/|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
    "/__clerk/(.*)",
  ],
};
