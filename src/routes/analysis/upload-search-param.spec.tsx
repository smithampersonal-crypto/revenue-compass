// @vitest-environment jsdom
/**
 * Package 3B-1A — `?upload=1` may reach the page as the string "1" or, after
 * the router's JSON search parsing, as the number 1. Both must open the upload
 * step without crashing; a missing parameter must not.
 */
import { render, screen } from "@testing-library/react";
import type { ComponentType } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

let currentSearch: Record<string, unknown> = {};

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    createFileRoute: () => (options: unknown) => ({ options }),
    useNavigate: () => vi.fn(),
    useSearch: () => currentSearch,
  };
});

vi.mock("@/components/arc/analysis-context", () => ({
  useAnalysis: () => ({ persistence: { mode: "guest" }, sample: null }),
}));

vi.mock("@/components/arc/documents/GuestSourceDocumentsWorkspace", () => ({
  GuestSourceDocumentsWorkspace: ({ autoOpenUpload }: { autoOpenUpload: boolean }) => (
    <p>auto-open:{String(autoOpenUpload)}</p>
  ),
}));

vi.mock("@/components/arc/documents/SourceDocumentsWorkspace", () => ({
  SourceDocumentsWorkspace: () => null,
}));

const documentsRoute = (await import("@/routes/analysis/documents")).Route as unknown as {
  options: { component: ComponentType };
};
const analysisRoute = (await import("@/routes/analysis/route")).Route as unknown as {
  options: { validateSearch: (s: Record<string, unknown>) => Record<string, unknown> };
};

const Page = documentsRoute.options.component;

beforeEach(() => {
  currentSearch = {};
});

describe("/analysis/documents upload intent", () => {
  it("opens the upload step when upload is the string \"1\"", () => {
    currentSearch = { upload: "1" };
    render(<Page />);
    expect(screen.getByText("auto-open:true")).toBeInTheDocument();
  });

  it("opens the upload step when upload is the number 1, without crashing", () => {
    currentSearch = { upload: 1 };
    render(<Page />);
    expect(screen.getByText("auto-open:true")).toBeInTheDocument();
  });

  it("does not open the upload step without the parameter", () => {
    render(<Page />);
    expect(screen.getByText("auto-open:false")).toBeInTheDocument();
  });

  it("normalizes a numeric upload value to text in the analysis search", () => {
    const validate = analysisRoute.options.validateSearch;
    expect(validate({ upload: 1 })).toEqual({ upload: "1" });
    expect(validate({ upload: "1" })).toEqual({ upload: "1" });
    expect(validate({})).toEqual({});
    expect(validate({ upload: { x: 1 } })).toEqual({});
  });
});
