export function buildBranchFilter(user: any, query: any) {
    // User must be logged in
    if (!user) return {};

    // SUPER ADMIN
    if (user.roleType === "ADMIN") {
        // If branchId provided → filter that branch
        if (query.branchId) {
            return { branchId: Number(query.branchId) };
        }

        // Otherwise → all branches
        return {};
    }

    // NORMAL USER → only their branch
    return { branchId: user.branchId };
}
