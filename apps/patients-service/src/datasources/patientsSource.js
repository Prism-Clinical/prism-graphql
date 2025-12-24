"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.patientsSource = void 0;
const resolvers_types_1 = require("@patients/__generated__/resolvers-types");
exports.patientsSource = [
    {
        id: "patient-1",
        mrn: "MRN123456",
        firstName: "John",
        lastName: "Doe",
        dateOfBirth: "1985-03-15",
        gender: resolvers_types_1.Gender.Male,
        email: "john.doe@email.com",
        phone: "(555) 123-4567",
        address: {
            street: "123 Main St",
            city: "Anytown",
            state: "CA",
            zipCode: "12345",
            country: "USA"
        }
    },
    {
        id: "patient-2",
        mrn: "MRN789012",
        firstName: "Jane",
        lastName: "Smith",
        dateOfBirth: "1978-11-22",
        gender: resolvers_types_1.Gender.Female,
        email: "jane.smith@email.com",
        phone: "(555) 987-6543",
        address: {
            street: "456 Oak Ave",
            city: "Healthcare City",
            state: "NY",
            zipCode: "67890",
            country: "USA"
        }
    },
    {
        id: "patient-3",
        mrn: "MRN345678",
        firstName: "Alex",
        lastName: "Johnson",
        dateOfBirth: "1992-07-08",
        gender: resolvers_types_1.Gender.Other,
        email: "alex.johnson@email.com",
        phone: "(555) 456-7890"
    }
];
//# sourceMappingURL=patientsSource.js.map