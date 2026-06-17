const bcrypt = require("bcrypt");
const adminRepo = require("../repositories/adminRepository");

const addDepartment = async (req, res, next) => {
  try {
    const { name } = req.body;
    const tenantId = req.user.tenant_id;
    const department = await adminRepo.createDepartment(tenantId, name);
    res.status(201).json({ status: "success", data: department });
  } catch (error) {
    next(error);
  }
};

const fetchDepartments = async (req, res, next) => {
  try {
    // If the frontend explicitly asks to NOT paginate (e.g. for dropdowns)
    if (req.query.paginate === "false") {
      const data = await adminRepo.getDepartments(req.user.tenant_id);
      return res.status(200).json({ status: "success", data });
    }

    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 5;
    const search = req.query.search || "";
    const offset = (page - 1) * limit;

    const { data, totalRecords } = await adminRepo.getDepartmentsPaginated(
      req.user.tenant_id,
      limit,
      offset,
      search,
    );

    res.status(200).json({
      status: "success",
      data,
      pagination: {
        currentPage: page,
        totalPages: Math.ceil(totalRecords / limit),
        totalRecords,
        limit,
      },
    });
  } catch (error) {
    next(error);
  }
};

const fetchMarkets = async (req, res, next) => {
  try {
    if (req.query.paginate === "false") {
      const data = await adminRepo.getMarkets(req.user.tenant_id);
      return res.status(200).json({ status: "success", data });
    }

    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 5;
    const search = req.query.search || "";
    const offset = (page - 1) * limit;

    const { data, totalRecords } = await adminRepo.getMarketsPaginated(
      req.user.tenant_id,
      limit,
      offset,
      search,
    );

    res.status(200).json({
      status: "success",
      data,
      pagination: {
        currentPage: page,
        totalPages: Math.ceil(totalRecords / limit),
        totalRecords,
        limit,
      },
    });
  } catch (error) {
    next(error);
  }
};

const fetchStores = async (req, res, next) => {
  try {
    if (req.query.paginate === "false") {
      const data = await adminRepo.getStores(req.user.tenant_id);
      return res.status(200).json({ status: "success", data });
    }

    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 5;
    const search = req.query.search || "";
    const offset = (page - 1) * limit;

    const { data, totalRecords } = await adminRepo.getStoresPaginated(
      req.user.tenant_id,
      limit,
      offset,
      search,
    );

    res.status(200).json({
      status: "success",
      data,
      pagination: {
        currentPage: page,
        totalPages: Math.ceil(totalRecords / limit),
        totalRecords,
        limit,
      },
    });
  } catch (error) {
    next(error);
  }
};

const addMarket = async (req, res, next) => {
  try {
    const { name } = req.body;
    const tenantId = req.user.tenant_id;
    const market = await adminRepo.createMarket(tenantId, name);
    res.status(201).json({ status: "success", data: market });
  } catch (error) {
    next(error);
  }
};

const addStore = async (req, res, next) => {
  try {
    const { id, marketId, name } = req.body;
    const tenantId = req.user.tenant_id;

    const store = await adminRepo.createStore(tenantId, marketId, name, id);
    res.status(201).json({ status: "success", data: store });
  } catch (error) {
    if (error.code === "23505") {
      res.status(409);
      return next(new Error("A store with this UUID already exists."));
    }
    next(error);
  }
};

const provisionUser = async (req, res, next) => {
  try {
    // 🟢 NEW: Extract `id` from req.body
    const { id, name, email, password, role, departmentId, marketId, storeId } =
      req.body;
    const tenantId = req.user.tenant_id;

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    const dept = departmentId || null;
    const mkt = marketId || null;
    const str = storeId || null;

    const newUser = await adminRepo.createUser(
      tenantId,
      name,
      email,
      passwordHash,
      role,
      dept,
      mkt,
      str,
      id, // 🟢 NEW: Pass the ID to the repository
    );

    res
      .status(201)
      .json({ status: "success", message: "User provisioned", data: newUser });
  } catch (error) {
    if (error.code === "23505") {
      res.status(400);
      next(new Error("A user with this email or ID already exists."));
    } else {
      next(error);
    }
  }
};

const fetchWorkload = async (req, res, next) => {
  try {
    const { tenant_id: tenantId, role, department_id: departmentId } = req.user;
    const workload = await adminRepo.getTeamWorkload(
      tenantId,
      role,
      departmentId,
    );
    res.status(200).json({ status: "success", data: workload });
  } catch (error) {
    next(error);
  }
};

const fetchUsers = async (req, res, next) => {
  try {
    const tenantId = req.user.tenant_id;

    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const search = req.query.search || "";
    const roleFilter = req.query.role || "ALL";

    const offset = (page - 1) * limit;

    const { users, totalRecords } = await adminRepo.getUsersWithDetails(
      tenantId,
      limit,
      offset,
      search,
      roleFilter,
    );

    const totalPages = Math.ceil(totalRecords / limit);

    res.status(200).json({
      status: "success",
      data: users,
      pagination: {
        currentPage: page,
        totalPages,
        totalRecords,
        limit,
      },
    });
  } catch (error) {
    next(error);
  }
};

const updateUserStatus = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { is_active } = req.body;
    const tenantId = req.user.tenant_id;

    if (String(id) === String(req.user.userId || req.user.id)) {
      return res.status(400).json({
        status: "error",
        message: "You cannot deactivate your own account.",
      });
    }

    const updatedUser = await adminRepo.toggleUserStatus(
      tenantId,
      id,
      is_active,
    );

    res.status(200).json({
      status: "success",
      message: `User ${is_active ? "activated" : "deactivated"} successfully`,
      data: updatedUser,
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  addDepartment,
  addMarket,
  addStore,
  provisionUser,
  fetchDepartments,
  fetchMarkets,
  fetchStores,
  fetchWorkload,
  fetchUsers,
  updateUserStatus,
};
