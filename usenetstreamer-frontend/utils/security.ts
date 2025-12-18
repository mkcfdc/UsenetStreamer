import * as bcrypt from "bcryptjs";

export const hashPassword = async (password: string): Promise<string> => {
    const salt = await bcrypt.genSalt(10);
    return await bcrypt.hash(password, salt);
};

export const comparePassword = async (plain: string, hash: string): Promise<boolean> => {
    return await bcrypt.compare(plain, hash);
};