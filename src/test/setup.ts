// Adds the jest-dom matchers (toBeInTheDocument, toHaveAttribute, ...) to
// Vitest's `expect`, including their TypeScript augmentation — which is why no
// `types` entry for them is needed in tsconfig.app.json.
import '@testing-library/jest-dom/vitest';
