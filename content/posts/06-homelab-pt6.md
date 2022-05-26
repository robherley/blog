---
title: "🏡 Homelab VI: Terraforming Proxmox"
date: 2022-01-14T00:00:00-05:00
draft: false
tags:
  - proxmox
  - vm
  - lxc
  - terraform
---

In the previous part of this series, I configured a template VM with cloud-init configs for zero intervention VM automation after provision.

In this part, I'll setup a basic HashiCorp Terraform project for infrastructure as code (IaC) to provision the guest VMs and containers from Proxmox. This will be a great foundation for the homelab, as Terraform can be expanded to cloud automation as well, such as [managing Cloudflare DNS records](https://registry.terraform.io/providers/cloudflare/cloudflare/latest/docs).

## What is Terraform?

Terraform is a powerful tool from HashiCorp, they explain it pretty well:

> Terraform is an open-source infrastructure as code software tool that provides a consistent CLI workflow to manage hundreds of cloud services. Terraform codifies cloud APIs into declarative configuration files.

(When people mention IaC, 9 times out of 10 it's referring to Terraform.)

It's an extremely popular tool due to it's easy to learn declarative language (HCL) and extensive [cloud provider support](https://registry.terraform.io/browse/providers). Plus, the entire deployment process is so simple, it's just two commands: `terraform plan` and `terraform apply`.

## Installing Terraform locally

Terraform can be found on most package managers, and they have [binaries](https://www.terraform.io/downloads) as well. I'll be placing all of the configuration within a `terraform` directory on my homelab repository at [robherley/homelab](https://github.com/robherley/homelab/tree/main/ansible).

## Creating an automation user

Similar to Ansible, an API user for Proxmox will need to be created for Terraform.

On one of the Proxmox nodes, make a `terraform` user, add it to the automation group, and set a password:

{{< terminal >}}
root@r720$ pveum user add terraform@pve --groups automation --password <some password>
{{< /terminal >}}

## Provider

There's a [Proxmox provider](https://registry.terraform.io/providers/Telmate/proxmox/latest/docs) on the Terraform registry, this'll be the coupling for Terraform to communicate to the Proxmox API and understand how to reconcile the defined Terraform state.

First, Terrafrom needs to know about the Proxmox provider.

In `terrafrom/main.tf`:

```terraform
terraform {
  required_providers {
    proxmox = {
      source  = "telmate/proxmox"
      version = "2.9.4"
    }
  }
}
```

Then, Terraform can be initialized and install the defined plugin:

{{< terminal >}}
rob@macbook$ terraform init

Initializing the backend...

Initializing provider plugins...
- Finding telmate/proxmox versions matching "2.9.4"...
- Installing telmate/proxmox v2.9.4...
- Installed telmate/proxmox v2.9.4 (self-signed, key ID A9EBBE091B35AFCE)

...

Terraform has been successfully initialized!
{{< /terminal >}}

To actually connect Proxmox and Terraform, a provider needs be defined.

In `terraform/providers.tf`:

```terraform
provider "proxmox" {
  pm_parallel     = 1
  pm_tls_insecure = true
  pm_debug        = true
  pm_api_url      = var.pm_api_url
  pm_password     = var.pm_password
  pm_user         = var.pm_user
}
```

This is the basic configuration for the provider, most is self explanatory. The `pm_parallel` command is set to only allow one Proxmox operation at a time.

The `var.*` parameters are special, those'll be defined in a variables file.

## Variables

Terraform has input variables, which let you customize aspects of Terraform modules without altering the module's own source code. [Input variables](https://www.terraform.io/language/values/variables) are declared in blocks within `.tf` files, and their actual values are in a `.tfvars` file.

In `terraform/variables.tf`:

```terraform
variable "pm_api_url" {
  default = "https://192.168.1.100:8006/api2/json"
}

variable "pm_user" {
  default = "terraform@pve"
}

variable "pm_password" {
  sensitive = true
}

variable "vm_template_name" {
  default = "ubuntu-cloudinit-template"
}

variable "lxc_template_name" {
  default = "ubuntu-ct-template"
}
```

Most of these variable blocks are using `default`, which makes the variable optional. This is just because I'm lazy and I'm just defining any public variables here. The `pm_password` var is `sensitive` (not shown in Terraform output) with no default, and it will be defined in a `.tfvars` file that won't be checked into git. As for the `*_template_name` variables, those'll be used in a bit.

In `terraform/terraform.tfvars`, add the `terraform` Proxmox user password:

```terraform
pm_password = "correct-horse-battery-staple"
```

Now, the actual resources can be defined. And like anything else in HCL, it's denoted in a block syntax.

In `terraform/resources.tf`:

```terraform
resource "proxmox_vm_qemu" "tf-test" {
  name        = "tf-test"
  target_node = "r720"
  clone       = var.vm_template_name

  cores       = 4
  memory      = 8192
  agent       = 1
}
```

This will create a VM with the name `tf-test`, which will be a full clone of `var.vm_template_name` that was defined in `variables.tf`. Unfortunately unlike the `qm clone` command, the attributes of the VM are not carried over in this provider's Terraform clone (it's programmed to use defaults instead) so the bare minimal parameters are specified.

💡 For explanations of all the parameters, see the provider's [argument reference](https://registry.terraform.io/providers/Telmate/proxmox/latest/docs/resources/vm_qemu#argument-reference).

To plan the change, run `terraform plan`:

{{< terminal >}}
rob@macbook$ $ terraform plan

Terraform used the selected providers to generate the following execution plan. Resource actions are indicated with the following
symbols:
  + create

Terraform will perform the following actions:

  # proxmox_vm_qemu.tf-test will be created
  + resource "proxmox_vm_qemu" "tf-test" {
      + additional_wait           = 0
      + agent                     = 1
      + automatic_reboot          = true
      + balloon                   = 0
      + bios                      = "seabios"
      + boot                      = "c"
      + bootdisk                  = (known after apply)
      + clone                     = "ubuntu-cloudinit-template"
      + clone_wait                = 0
      + cores                     = 4
      + cpu                       = "host"
      + default_ipv4_address      = (known after apply)
      + define_connection_info    = true
      + force_create              = false
      + full_clone                = true
      + guest_agent_ready_timeout = 100
      + hotplug                   = "network,disk,usb"
      + id                        = (known after apply)
      + kvm                       = true
      + memory                    = 8192
      + name                      = "tf-test"
      + nameserver                = (known after apply)
      + numa                      = false
      + onboot                    = false
      + oncreate                  = true
      + preprovision              = true
      + reboot_required           = (known after apply)
      + scsihw                    = (known after apply)
      + searchdomain              = (known after apply)
      + sockets                   = 1
      + ssh_host                  = (known after apply)
      + ssh_port                  = (known after apply)
      + tablet                    = true
      + target_node               = "r720"
      + unused_disk               = (known after apply)
      + vcpus                     = 0
      + vlan                      = -1
      + vmid                      = (known after apply)
    }

...
{{< /terminal >}}

Once the plan is confirmed to be okay, it can be applied:

{{< terminal >}}
rob@macbook$ $ terraform apply
...

proxmox_vm_qemu.tf-test: Creating...
proxmox_vm_qemu.tf-test: Still creating... [10s elapsed]
proxmox_vm_qemu.tf-test: Still creating... [20s elapsed]
proxmox_vm_qemu.tf-test: Still creating... [30s elapsed]
proxmox_vm_qemu.tf-test: Still creating... [40s elapsed]
proxmox_vm_qemu.tf-test: Still creating... [50s elapsed]
proxmox_vm_qemu.tf-test: Still creating... [1m0s elapsed]
proxmox_vm_qemu.tf-test: Creation complete after 1m3s [id=r720/qemu/101]

Apply complete! Resources: 1 added, 0 changed, 0 destroyed.
{{< /terminal >}}

Now to double check with Ansible:

{{< terminal >}}
rob@macbook$ ansible proxmox_all_running -m ping
tf-test | SUCCESS => {
    "ansible_facts": {
        "discovered_interpreter_python": "/usr/bin/python3"
    },
    "changed": false,
    "ping": "pong"
}
{{< /terminal >}}

Perfect! The homelab infrastructure is now fully declarative and automated.

❗**Note:** during testing, I have found the provider to be flaky at points when determining if the VM or LXC is created or not. Apparently this is a [known issue](https://github.com/Telmate/terraform-provider-proxmox/issues/480#issuecomment-1005949219) with the provider, due to a bug when interacting with Proxmox conf locks. Either the provider can be downgraded to version `2.8.0` or existing resources can be imported into Terraform's state like so:

{{< terminal >}}
# terraform import <resource type>.<resource name> <node>/<type>/<vmid>
rob@macbook$ terraform import proxmox_vm_qemu.tf-test r720/qemu/101
{{< /terminal >}}

## Conclusion

Well, that's it for the homelab series! I think six parts is enough to conclude. The homelab is now a fully operational virtualization cluster with redundant ZFS (and NFS) storage, VM/LXC templates, automated with Ansible and provisioned via IaC with Terraform. There _may_ be separate one-offs for TrueNAS, Kubernetes or OpenShift clusters, but no promises. Thanks for tagging along!